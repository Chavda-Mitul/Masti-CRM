import type { ConsentField } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged, staleError } from "../../lib/changes";
import { istToday } from "../../lib/dates";
import { conflict, fieldError, forbidden, notFound } from "../../lib/httpError";
import { activeFilter, saveChanges } from "../../lib/masters";
import { rethrowUnique } from "../../lib/prismaErrors";
import { isHodOf } from "../auth/permissions";
import { assertCanSeeClient } from "../clients/access";
import { memberInclude, toMemberDto } from "../clients/client";
import { getClientSettings } from "../clients/clients.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import { assertCanEditVisaMasters } from "../visaMasters/access";
import { companyForPage, wordingInUse } from "./consent.public.service";
import type {
  AddConsentWordingInput,
  CreateConsentFieldInput,
  OrderConsentFieldsInput,
  PaperConsentInput,
  UpdateConsentFieldInput,
} from "./consent.schemas";

// The office's side of the consent form (docs/decisions/0022-consent-form.md). Part 2b: the wording in Settings; the
// Head and the Visa HOD add versions, the newest is the one clients agree to, and a version is never changed or removed
// (a database trigger), so each consent keeps the exact words it was given to. Amendment 1: the form's fields in
// Settings, which they add, rename, reorder and switch off. Part 3: consents signed on paper before the CRM, marked on
// file from the client page.

// ---------------------------------------------------------------------------
// The form's fields (amendment 1, change request 18)
// ---------------------------------------------------------------------------

/** Another field has this name: one on the form, or one switched off that could be switched back on. */
const sameName = (label: string, isActive = true) =>
  isActive
    ? `A field called “${label}” is already on the form. Pick another name.`
    : `A field called “${label}” is switched off. Switch it back on, or pick another name.`;

/** Every field in the form's order (`?active=` filters): switched-off ones too, for the Settings page. */
export async function listConsentFields(active?: boolean) {
  return prisma.consentField.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

/** Two fields can't share a name, ignoring case and spaces at the ends (also a unique index, for two saves at once). */
async function assertNameFree(label: string, exceptId?: number) {
  const taken = await prisma.consentField.findFirst({
    where: { label: { equals: label, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (taken) throw conflict(sameName(taken.label, taken.isActive));
}

/** A new field, at the end of the form. It's on the form from now on; its kind never changes. */
export async function createConsentField(input: CreateConsentFieldInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  await assertNameFree(input.label);
  return prisma
    .$transaction(async (tx) => {
      const last = await tx.consentField.aggregate({ _max: { sortOrder: true } });
      const field = await tx.consentField.create({ data: { ...input, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
      await audit({ actorId: actor.user.id, action: "consentField.create", entityType: "ConsentField", entityId: String(field.id), after: field, ip: actor.ip }, tx);
      return field;
    })
    .catch(rethrowUnique(sameName(input.label)));
}

/**
 * Renames a field, makes it required or not, or switches it off or on. The three fixed fields (other screens read them)
 * keep their name and stay on; only "required" changes, and never for the date of birth (also checked by the database).
 * People's answers to a field switched off are kept, for when it's switched back on.
 */
export async function updateConsentField(id: number, input: UpdateConsentFieldInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.consentField.findUnique({ where: { id } });
  if (!before) throw notFound("Field not found.");
  const changes = onlyChanged(definedOnly(input), before);
  if (before.fixed) {
    if (changes.label !== undefined || changes.isActive !== undefined) throw conflict(fixedMessage(before));
    if (before.fixed === "DATE_OF_BIRTH" && changes.required === false) {
      throw conflict("The date of birth is always needed: it tells us who is a child.");
    }
  }
  if (changes.label !== undefined) await assertNameFree(changes.label, id);
  return saveChanges({
    before,
    changes,
    actor,
    action: "consentField.update",
    entityType: "ConsentField",
    entityId: id,
    write: (tx) => tx.consentField.update({ where: { id }, data: changes }),
  }).catch(rethrowUnique(sameName(changes.label ?? before.label)));
}

function fixedMessage(field: ConsentField) {
  const usedBy = field.fixed === "DATE_OF_BIRTH" ? "a person’s age comes from it" : "the covering letter prints it";
  return `${field.label} stays on the form with its name: ${usedBy}. Only whether it’s needed can change.`;
}

/**
 * The form's new order: every field, first to last. A field added since the page loaded makes it stale (409), so
 * nobody's order drops a field they haven't seen. Audited once, with the order before and after.
 */
export async function orderConsentFields(input: OrderConsentFieldsInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  await prisma.$transaction(async (tx) => {
    // Two orders at once: the second waits here, then finds the first one's order.
    await tx.$queryRaw`SELECT "id" FROM "ConsentField" ORDER BY "id" FOR UPDATE`;
    const before = await tx.consentField.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    const ids = before.map((f) => f.id);
    if (input.ids.length !== ids.length || [...input.ids].sort((a, b) => a - b).join() !== [...ids].sort((a, b) => a - b).join()) {
      throw staleError("list of fields");
    }
    if (input.ids.join() === ids.join()) return;
    for (const [i, id] of input.ids.entries()) await tx.consentField.update({ where: { id }, data: { sortOrder: i + 1 } });
    await audit(
      { actorId: actor.user.id, action: "consentField.order", entityType: "ConsentField", before: { ids }, after: { ids: input.ids }, ip: actor.ip },
      tx,
    );
  });
  return listConsentFields();
}

/** Every version, newest first: the first is the one in use. A null addedBy is the draft set up with the system. */
export async function listConsentWordings() {
  return prisma.consentWording.findMany({
    orderBy: { id: "desc" },
    select: { id: true, body: true, createdAt: true, addedBy: { select: { id: true, name: true } } },
  });
}

/**
 * A new version, used from now on. basedOnId is the version the editor opened: if another was added since, the save is
 * stale (409), so nobody replaces words they haven't seen.
 */
export async function addConsentWording(input: AddConsentWordingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  await prisma.$transaction(async (tx) => {
    // Two saves at once: the second waits here, then finds the first one's version in use and is told to reload.
    await tx.$queryRaw`SELECT "id" FROM "ConsentWording" WHERE "id" = ${input.basedOnId} FOR UPDATE`;
    const inUse = await wordingInUse(tx);
    if (inUse.id !== input.basedOnId) throw staleError("wording");
    if (inUse.body === input.body) throw fieldError("body", "That's the wording already in use. Change something first.");
    const version = await tx.consentWording.create({ data: { body: input.body, addedById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "consent.wording.add",
        entityType: "ConsentWording",
        entityId: String(version.id),
        before: { versionId: inUse.id },
        after: { versionId: version.id, body: input.body },
        ip: actor.ip,
      },
      tx,
    );
  });
  return listConsentWordings();
}

/** Paper consents are marked, and a mistaken mark taken off, by the Head or the Visa HOD (the lead, 21 Oct 2026). */
function assertCanMarkPaper(user: UserWithDepartments) {
  if (!isHodOf(user, "VISA")) throw forbidden("Only the Head or the Visa HOD can mark a consent signed on paper.");
}

/** The person on this client, held while their consent changes, as "I agree" holds them: the two go one at a time. */
async function lockedMember(tx: Db, clientId: string, memberId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ClientMember" WHERE "id" = ${memberId} FOR UPDATE`;
  const member = await tx.clientMember.findFirst({ where: { id: memberId, clientId }, include: { consent: true } });
  if (!member) throw notFound("Person not found on this client.");
  return member;
}

/** The person as the client page shows them, with their consent column. */
async function memberDto(memberId: string) {
  const member = await prisma.clientMember.findUniqueOrThrow({ where: { id: memberId }, include: memberInclude });
  return toMemberDto(member, istToday(), await getClientSettings());
}

/**
 * A consent signed on paper before the CRM, marked on file with the year it was signed (part 3): that person never gets
 * the "I agree" link, and a link still open stops working.
 */
export async function markPaperConsent(clientId: string, memberId: string, input: PaperConsentInput, actor: Actor) {
  assertCanMarkPaper(actor.user);
  await assertCanSeeClient(actor.user, clientId);
  if (input.year > Number(istToday().slice(0, 4))) throw fieldError("year", "Pick this year or an earlier one.");
  await prisma.$transaction(async (tx) => {
    const member = await lockedMember(tx, clientId, memberId);
    if (member.archivedAt) throw conflict("This person was taken off the family list.");
    if (member.consent) throw conflict("Their consent is already on file.");
    const now = new Date();
    await tx.consentLink.updateMany({ where: { memberId, usedAt: null, replacedAt: null }, data: { replacedAt: now } });
    const consent = await tx.consent.create({
      data: { memberId, source: "PAPER", agreedAt: now, paperYear: input.year, markedById: actor.user.id },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "consent.paper.mark",
        entityType: "Consent",
        entityId: consent.id,
        clientId,
        after: { memberId, year: input.year },
        ip: actor.ip,
      },
      tx,
    );
  });
  return memberDto(memberId);
}

/**
 * The printable record of one person's consent (part 3b), for anyone who can see the client. Through the link: the
 * details and the wording exactly as agreed (the saved copies, not today's), how and when the link was sent and agreed
 * through, and the phone's address and browser. On paper: the year, and who marked it on file when. Printing changes
 * nothing, so it isn't audited.
 */
export async function consentRecord(clientId: string, memberId: string, user: UserWithDepartments) {
  await assertCanSeeClient(user, clientId);
  const member = await prisma.clientMember.findFirst({
    where: { id: memberId, clientId },
    select: {
      name: true,
      consent: {
        include: {
          wording: { select: { id: true, body: true, createdAt: true } },
          link: { select: { createdAt: true, toMobile: true, createdBy: { select: { name: true } }, enquiry: { select: { caseNo: true } } } },
          markedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!member) throw notFound("Person not found on this client.");
  const { consent } = member;
  if (!consent) throw notFound("No consent is on file for this person.");
  const company = await companyForPage();
  if (consent.source === "PAPER") {
    return {
      source: "PAPER" as const,
      name: member.name,
      paperYear: consent.paperYear,
      markedAt: consent.agreedAt,
      markedBy: consent.markedBy?.name ?? null,
      company,
    };
  }
  return {
    source: "LINK" as const,
    name: member.name,
    agreedAt: consent.agreedAt,
    person: consent.details,
    wording: consent.wording,
    link: consent.link && {
      sentAt: consent.link.createdAt,
      toMobile: consent.link.toMobile,
      sentBy: consent.link.createdBy.name,
      caseNo: consent.link.enquiry.caseNo,
    },
    ip: consent.ip,
    userAgent: consent.userAgent,
    company,
  };
}

/** Takes a paper mark off, for a mistake: the person can then get the link. A consent given through the link stays. */
export async function removePaperConsent(clientId: string, memberId: string, actor: Actor) {
  assertCanMarkPaper(actor.user);
  await assertCanSeeClient(actor.user, clientId);
  await prisma.$transaction(async (tx) => {
    const { consent } = await lockedMember(tx, clientId, memberId);
    if (!consent) throw conflict("There's no consent on file to take off.");
    if (consent.source !== "PAPER") throw conflict("A consent given through the link is kept for good.");
    await tx.consent.delete({ where: { id: consent.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "consent.paper.remove",
        entityType: "Consent",
        entityId: consent.id,
        clientId,
        before: { memberId, year: consent.paperYear, markedById: consent.markedById, markedAt: consent.agreedAt },
        ip: actor.ip,
      },
      tx,
    );
  });
  return memberDto(memberId);
}
