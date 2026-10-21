import type { ClientMember } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, notFound } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { CONSENTING, loadCase, lockCase } from "./caseLock";
import type { ConsentDetailsInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";

// The consent & liability form, part 1 (docs/decisions/0022-consent-form.md): staff fill in a traveller's details by
// asking the client. They live on the person (ClientMember), for life, so the next case and the visa forms reuse them;
// the consent the client agrees to (part 2) keeps a copy of them as they were.

const DATES = ["dateOfBirth", "spouseDateOfBirth", "anniversary", "motherDateOfBirth", "fatherDateOfBirth"] as const;

/**
 * Saves the form for one named traveller, for the owner, the HOD or the Head, from Documents until the handover. Every
 * field is replaced; someone who changed the person meanwhile (here or on the client page) makes it stale.
 */
export async function saveConsentDetails(caseNo: string, travellerId: string, input: ConsentDetailsInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CONSENTING);
  const traveller = await prisma.visaCaseTraveller.findFirst({ where: { id: travellerId, caseId: enquiry.id }, select: { memberId: true } });
  if (!traveller) throw notFound("Traveller not found on this case.");
  const memberId = traveller.memberId;
  if (!memberId) throw conflict("Name this traveller first: the details belong to the person.");
  const today = istToday();
  for (const field of DATES) {
    const day = input[field];
    if (day && day > today) throw fieldError(field, "This date is in the future.");
  }

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, CONSENTING);
    const before = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId } });
    if (before.archivedAt) throw conflict("This person was taken off the family list.");
    assertFresh(before.updatedAt, input.updatedAt, "person");
    const day = (value: string | null) => (value ? toDbDate(value) : null);
    const { count } = await tx.clientMember.updateMany({
      where: { id: memberId, updatedAt: before.updatedAt },
      data: {
        dateOfBirth: toDbDate(input.dateOfBirth),
        spouseDateOfBirth: day(input.spouseDateOfBirth),
        anniversary: day(input.anniversary),
        motherDateOfBirth: day(input.motherDateOfBirth),
        fatherDateOfBirth: day(input.fatherDateOfBirth),
        residentialAddress: input.residentialAddress,
        officeAddress: input.officeAddress,
        annualIncome: input.annualIncome,
        profession: input.profession,
        education: input.education,
        consentDetailsAt: new Date(),
        consentDetailsById: actor.user.id,
      },
    });
    if (count === 0) throw staleError("person");
    const after = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId } });
    await audit(
      {
        actorId: actor.user.id,
        action: "member.consent_details",
        entityType: "ClientMember",
        entityId: memberId,
        clientId: enquiry.clientId,
        before: detailsOf(before),
        after: detailsOf(after),
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/** The form's fields as the audit log keeps them: dates as days. */
function detailsOf(m: ClientMember) {
  const day = (value: Date | null) => (value ? fromDbDate(value) : null);
  return {
    dateOfBirth: day(m.dateOfBirth),
    spouseDateOfBirth: day(m.spouseDateOfBirth),
    anniversary: day(m.anniversary),
    motherDateOfBirth: day(m.motherDateOfBirth),
    fatherDateOfBirth: day(m.fatherDateOfBirth),
    residentialAddress: m.residentialAddress,
    officeAddress: m.officeAddress,
    annualIncome: m.annualIncome,
    profession: m.profession,
    education: m.education,
  };
}
