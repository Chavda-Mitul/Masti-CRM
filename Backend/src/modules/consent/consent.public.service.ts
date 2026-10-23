import { createHash } from "node:crypto";
import type { ClientMember, Relation } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { HttpError, notFound } from "../../lib/httpError";
import { getCompanyDetails } from "../company/company.settings";
import { activeConsentFields, answerOf, type AnsweringPerson } from "./consentFields";
import { hashConsentToken } from "./consentToken";

// The client's side of the consent form (docs/decisions/0022-consent-form.md, part 2): what the link opens, and "I
// agree". No login: the secret token is the key. A link works until it is used or a newer one replaces it.

const INVALID = "This link isn't valid. Please use the link in Masti Tours & Travels' WhatsApp message.";
const REPLACED = "This link was replaced by a newer one. Please use the latest message from Masti Tours & Travels.";

const replaced = () => new HttpError(410, REPLACED, { code: "REPLACED" });

/** The wording in use: the newest version. */
export async function wordingInUse(db: Db = prisma) {
  const wording = await db.consentWording.findFirst({ orderBy: { id: "desc" }, select: { id: true, body: true } });
  if (!wording) throw new HttpError(503, "The form isn't ready yet. Please call Masti Tours & Travels.");
  return wording;
}

/** What the form needs of the person: their name, relation and passport, and their answers. */
export const formPersonInclude = { relation: true, consentAnswers: true } as const;

/**
 * The person as the form shows them, and as the consent keeps them once agreed: the name and current passport
 * number, then the details staff filled in, each with its field's label as it is now (amendment 1), so renaming a field
 * later never changes a record. Only the fields in use that have an answer, in the form's order.
 */
export async function formDetailsOf(db: Db, member: Pick<ClientMember, "name" | "passportNumber"> & AnsweringPerson & { relation: Relation }) {
  const fields = await activeConsentFields(db);
  return {
    name: member.name,
    relation: member.relation.name,
    passportNumber: member.passportNumber,
    rows: fields.flatMap((f) => {
      const value = answerOf(f, member);
      return value === null ? [] : [{ label: f.label, kind: f.kind, value }];
    }),
  };
}

type FormDetails = Awaited<ReturnType<typeof formDetailsOf>>;

/** The details' fingerprint: "I agree" sends back the one the page showed, so staff changing them meanwhile is caught. */
const detailsHashOf = (details: FormDetails) => createHash("sha256").update(JSON.stringify(details)).digest("hex");

/** Masti's name, address and phones for the page (and the printed record): nothing of its tax or bank details. */
export async function companyForPage() {
  const c = await getCompanyDetails();
  return { name: c.name, address: c.address, phone: c.phone, phone2: c.phone2 };
}

/** What the link opens: the form to agree to, or "already agreed" (with no details). */
export async function viewConsent(token: string) {
  const link = await prisma.consentLink.findUnique({
    where: { tokenHash: hashConsentToken(token) },
    include: { member: { include: { ...formPersonInclude, consent: true } } },
  });
  if (!link) throw notFound(INVALID);
  const company = await companyForPage();
  if (link.member.consent) return { state: "AGREED" as const, name: link.member.name, agreedAt: link.member.consent.agreedAt, company };
  if (link.replacedAt) throw replaced();
  const person = await formDetailsOf(prisma, link.member);
  return { state: "OPEN" as const, person, detailsHash: detailsHashOf(person), wording: await wordingInUse(), company };
}

/**
 * "I agree": records the consent with the wording and the details exactly as the page showed them, and where the tap
 * came from; the link is then used. A person who already agreed (through any link) just sees that again.
 */
export async function agreeConsent(
  token: string,
  shown: { wordingId: number; detailsHash: string },
  from: { ip: string | null; userAgent: string | null },
) {
  const { wordingId } = shown;
  const found = await prisma.consentLink.findUnique({ where: { tokenHash: hashConsentToken(token) }, select: { id: true, memberId: true } });
  if (!found) throw notFound(INVALID);

  return prisma.$transaction(async (tx) => {
    // In the same order as staff saving the details (the person, then the link), so the two never deadlock.
    await tx.$queryRaw`SELECT "id" FROM "ClientMember" WHERE "id" = ${found.memberId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "ConsentLink" WHERE "id" = ${found.id} FOR UPDATE`;
    const member = await tx.clientMember.findUniqueOrThrow({ where: { id: found.memberId }, include: { ...formPersonInclude, consent: true } });
    if (member.consent) return { state: "AGREED" as const, name: member.name, agreedAt: member.consent.agreedAt };
    const link = await tx.consentLink.findUniqueOrThrow({ where: { id: found.id } });
    if (link.replacedAt) throw replaced();
    const wording = await wordingInUse(tx);
    if (wording.id !== wordingId) {
      throw new HttpError(409, "The form changed while you were reading it. Please read it again.", { code: "WORDING_CHANGED" });
    }
    const details = await formDetailsOf(tx, member);
    if (detailsHashOf(details) !== shown.detailsHash) {
      throw new HttpError(409, "Your details changed while you were reading. Please check them again.", { code: "DETAILS_CHANGED" });
    }

    const agreedAt = new Date();
    const consent = await tx.consent.create({
      data: {
        memberId: member.id,
        agreedAt,
        wordingId,
        linkId: link.id,
        details,
        ip: from.ip,
        userAgent: from.userAgent?.slice(0, 500) ?? null,
      },
    });
    await tx.consentLink.update({ where: { id: link.id }, data: { usedAt: agreedAt } });
    await audit(
      {
        action: "consent.agree",
        entityType: "Consent",
        entityId: consent.id,
        clientId: member.clientId,
        after: { memberId: member.id, wordingId, linkId: link.id },
        ip: from.ip,
      },
      tx,
    );
    return { state: "AGREED" as const, name: member.name, agreedAt };
  });
}
