import type { ConsentField } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldErrors, HttpError, notFound } from "../../lib/httpError";
import { getCompanyDetails } from "../company/company.settings";
import { activeConsentFields, answerOf, answersOf, cleanAnswer, toConsentFieldDto, type AnsweringPerson } from "../consent/consentFields";
import { newConsentToken } from "../consent/consentToken";
import { VISA_CONSENT_LINK } from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";
import type { Actor } from "../users/user";
import { CONSENTING, loadCase, lockCase, type LockedCase } from "./caseLock";
import type { ConsentDetailsInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { visaMessageBasics } from "./visaMessages";

// The consent & liability form (docs/decisions/0022-consent-form.md). Part 1: staff fill in a traveller's details by
// asking the client; they live on the person (ClientMember), for life, so the next case and the visa forms reuse them.
// The fields are a master (amendment 1). Part 2: saving them sends the client the "I agree" link on WhatsApp, once,
// while the person hasn't agreed.

/** The case and the named traveller's person, for the owner, the HOD or the Head, from Documents until the handover. */
async function namedTraveller(caseNo: string, travellerId: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CONSENTING);
  const traveller = await prisma.visaCaseTraveller.findFirst({ where: { id: travellerId, caseId: enquiry.id }, select: { memberId: true } });
  if (!traveller) throw notFound("Traveller not found on this case.");
  if (!traveller.memberId) throw conflict("Name this traveller first: the details belong to the person.");
  return { enquiry, memberId: traveller.memberId };
}

/** Holds the person while their details or links change: a staff save and the client's "I agree" go one at a time. */
async function lockPerson(tx: Db, memberId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ClientMember" WHERE "id" = ${memberId} FOR UPDATE`;
}

/** The form changed in Settings while staff filled it in: a field added, switched off or switched on. */
const fieldsChanged = () =>
  new HttpError(409, "The form's fields changed while you were filling it in. Check them and save again.", { code: "FIELDS_CHANGED" });

/**
 * The form for one named traveller (amendment 1): the fields in use, in order, and the person's answers keyed by field
 * id. personUpdatedAt is the person's optimistic-lock token, sent back with the save.
 */
export async function getConsentDetails(caseNo: string, travellerId: string, actor: Actor) {
  const { memberId } = await namedTraveller(caseNo, travellerId, actor);
  const fields = await activeConsentFields(prisma);
  const member = await prisma.clientMember.findUniqueOrThrow({ where: { id: memberId }, include: { consentAnswers: true } });
  return { fields: fields.map(toConsentFieldDto), answers: answersOf(fields, member), personUpdatedAt: member.updatedAt };
}

/**
 * Saves the form for one named traveller. Every field in use is answered (or left empty) each time; someone who changed
 * the person meanwhile (here or on the client page) makes it stale, and so does a change to the fields in Settings.
 * Answers to fields switched off stay, for when they're switched back on. The first save for someone who hasn't agreed
 * sends their "I agree" link.
 */
export async function saveConsentDetails(caseNo: string, travellerId: string, input: ConsentDetailsInput, actor: Actor) {
  const { enquiry, memberId } = await namedTraveller(caseNo, travellerId, actor);
  const today = istToday();

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, CONSENTING);
    await lockPerson(tx, memberId);
    const fields = await activeConsentFields(tx);
    const sent = Object.keys(input.answers).sort().join();
    if (sent !== fields.map((f) => String(f.id)).sort().join()) throw fieldsChanged();
    const values = new Map<number, string | null>();
    const problems: Record<string, string> = {};
    for (const field of fields) {
      const answer = cleanAnswer(field, input.answers[String(field.id)] ?? null, today);
      if (answer.error !== undefined) problems[field.id] = answer.error;
      else values.set(field.id, answer.value);
    }
    if (Object.keys(problems).length > 0) throw fieldErrors(problems);

    const before = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId }, include: { consentAnswers: true } });
    if (before.archivedAt) throw conflict("This person was taken off the family list.");
    assertFresh(before.updatedAt, input.updatedAt, "person");
    // A fixed field's answer is a column on the person (fixed fields are always in use, and the date of birth is always
    // required, both checked by the database).
    const fixed = (which: NonNullable<ConsentField["fixed"]>) => values.get(fields.find((f) => f.fixed === which)!.id) ?? null;
    const { count } = await tx.clientMember.updateMany({
      where: { id: memberId, updatedAt: before.updatedAt },
      data: {
        dateOfBirth: toDbDate(fixed("DATE_OF_BIRTH")!),
        residentialAddress: fixed("HOME_ADDRESS"),
        officeAddress: fixed("OFFICE_ADDRESS"),
        consentDetailsAt: new Date(),
        consentDetailsById: actor.user.id,
      },
    });
    if (count === 0) throw staleError("person");
    const others = fields.filter((f) => f.fixed === null);
    const emptied = others.filter((f) => values.get(f.id) === null).map((f) => f.id);
    await tx.consentAnswer.deleteMany({ where: { memberId, fieldId: { in: emptied } } });
    for (const field of others) {
      const value = values.get(field.id);
      if (!value) continue;
      await tx.consentAnswer.upsert({
        where: { memberId_fieldId: { memberId, fieldId: field.id } },
        create: { memberId, fieldId: field.id, value },
        update: { value },
      });
    }
    const after = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId }, include: { consentAnswers: true } });
    await audit(
      {
        actorId: actor.user.id,
        action: "member.consent_details",
        entityType: "ClientMember",
        entityId: memberId,
        clientId: enquiry.clientId,
        before: detailsOf(fields, before),
        after: detailsOf(fields, after),
        ip: actor.ip,
      },
      tx,
    );
    // Part 2: the link goes once. Saving again sends nothing while it's open; "Send the link again" replaces it.
    const agreed = await tx.consent.findUnique({ where: { memberId }, select: { id: true } });
    const open = await tx.consentLink.findFirst({ where: { memberId, usedAt: null, replacedAt: null }, select: { id: true } });
    if (!agreed && !open) await sendLink(tx, enquiry, memberId, actor);
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * "Send the link again" (0022 part 2): for a lost message or a wrong number. The open link stops working and a new one
 * goes out. Only once the details are filled in, and only while the person hasn't agreed.
 */
export async function sendConsentLinkAgain(caseNo: string, travellerId: string, actor: Actor) {
  const { enquiry, memberId } = await namedTraveller(caseNo, travellerId, actor);
  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, CONSENTING);
    await lockPerson(tx, memberId);
    if (await tx.consent.findUnique({ where: { memberId }, select: { id: true } })) throw conflict("Their consent is already on file: there's nothing to send.");
    const member = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId }, select: { consentDetailsAt: true } });
    if (!member.consentDetailsAt) throw conflict("Fill in their details first: the link goes out when they're saved.");
    await tx.consentLink.updateMany({ where: { memberId, usedAt: null, replacedAt: null }, data: { replacedAt: new Date() } });
    await sendLink(tx, enquiry, memberId, actor);
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * A new link for the person, and message 4 carrying it, to their own number if saved, else the client's main one (the
 * project lead, 21 Oct 2026). Only the token's hash is kept.
 */
async function sendLink(tx: Db, enquiry: LockedCase, memberId: string, actor: Actor) {
  const member = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId }, select: { name: true, mobile: true } });
  const basics = await visaMessageBasics(tx, enquiry.id);
  const client = await tx.client.findUniqueOrThrow({ where: { id: basics.clientId }, select: { mobile: true } });
  const toMobile = member.mobile ?? client.mobile;
  const { tokenHash, url } = newConsentToken();
  const link = await tx.consentLink.create({ data: { memberId, enquiryId: enquiry.id, tokenHash, toMobile, createdById: actor.user.id } });
  await queueMessage(tx, {
    template: VISA_CONSENT_LINK,
    clientId: basics.clientId,
    enquiryId: enquiry.id,
    key: `${VISA_CONSENT_LINK}:${link.id}`,
    toMobile,
    variables: {
      ...basics.variables,
      recipient_name: member.mobile ? member.name : basics.variables.client_name,
      traveller_name: member.name,
      consent_link: url,
      office_phone: (await getCompanyDetails(tx)).phone,
    },
  });
  await audit(
    {
      actorId: actor.user.id,
      action: "consent.link.sent",
      entityType: "ConsentLink",
      entityId: link.id,
      clientId: enquiry.clientId,
      after: { memberId, toMobile },
      ip: actor.ip,
    },
    tx,
  );
}

/** The form's answers as the audit log keeps them: by each field's label, dates as days. */
function detailsOf(fields: ConsentField[], person: AnsweringPerson) {
  return Object.fromEntries(fields.map((f) => [f.label, answerOf(f, person)]));
}
