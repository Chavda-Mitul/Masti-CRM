import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { staleError } from "../../lib/changes";
import { istToday } from "../../lib/dates";
import { conflict, fieldError, forbidden, notFound } from "../../lib/httpError";
import { isHodOf } from "../auth/permissions";
import { assertCanSeeClient } from "../clients/access";
import { memberInclude, toMemberDto } from "../clients/client";
import { getClientSettings } from "../clients/clients.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import { assertCanEditVisaMasters } from "../visaMasters/access";
import { wordingInUse } from "./consent.public.service";
import type { AddConsentWordingInput, PaperConsentInput } from "./consent.schemas";

// The office's side of the consent form (docs/decisions/0022-consent-form.md). Part 2b: the wording in Settings; the
// Head and the Visa HOD add versions, the newest is the one clients agree to, and a version is never changed or removed
// (a database trigger), so each consent keeps the exact words it was given to. Part 3: consents signed on paper before
// the CRM, marked on file from the client page.

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
