import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, definedOnly, onlyChanged, pick } from "../../lib/changes";
import { conflict, fieldError, HttpError, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import { VISA_FLOW } from "../enquiries/enquiries.seed";
import { assertCanActOnEnquiry, assertCanSeeEnquiry } from "../enquiries/visibility";
import type { Actor } from "../users/user";
import type { LinkTravellerInput, MatureCaseInput, UpdateCaseDocumentInput, UpdateVisaCaseInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { countTravellers, travellerLabel } from "./visaCase";

// Visa Step 2, part one (docs/decisions/0006-visa-documents.md Decisions 2, 3 and 8): naming travellers, ticking
// documents, how they reach us and booklets (Decision 4), moving the case from Enquiry to Documents, and maturity.

/** The steps where the checklist can still change. After maturity it is the processor's to check (Step 3). */
const COLLECTING = ["ENQUIRY", "DOCUMENTS"];

const caseInclude = {
  department: { select: { code: true } },
  stage: true,
  visa: { select: { enquiryId: true } },
} satisfies Prisma.EnquiryInclude;

type Step2Case = Prisma.EnquiryGetPayload<{ include: typeof caseInclude }>;

/** Refuses unless this user may change the case and it is still collecting documents. */
function assertStep2(enquiry: Step2Case, actor: Actor) {
  assertCanSeeEnquiry(actor.user, enquiry);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status === "POSTPONED") throw conflict("This case is postponed. Resume it first.");
  if (enquiry.status !== "OPEN") throw conflict("This case is closed, so its documents can't change.");
  if (!COLLECTING.includes(enquiry.stage.code)) throw conflict("This case has moved past collecting documents.");
}

/** The case, if this user may change it and it is still collecting documents: the quick check before any transaction. */
async function loadForStep2(caseNo: string, actor: Actor) {
  const enquiry = await prisma.enquiry.findUnique({ where: { caseNo: caseNo.toUpperCase() }, include: caseInclude });
  if (!enquiry?.visa) throw notFound("Case not found.");
  assertStep2(enquiry, actor);
  return enquiry;
}

/**
 * The first thing every Step 2 write and maturity does in its transaction: lock the case's row, then read it again and
 * repeat the checks. They take the same lock, so they run one after another:
 * - a tick can't land between maturity's check that every paper is in and its move to File preparation
 * - a tick that waited behind maturity then sees the case has moved on, and is refused
 * Postpone, cancel and reassign update the same row, so a tick waits for them too and sees their result. Ticks don't
 * change the case's updatedAt, so they never make "Mark documents complete" on someone else's open page stale.
 */
async function lockForStep2(tx: Db, enquiryId: string, actor: Actor) {
  await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ${enquiryId} FOR UPDATE`;
  const enquiry = await tx.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, include: caseInclude });
  assertStep2(enquiry, actor);
  return enquiry;
}

/** One step of the visa flow, by code. */
async function visaStage(tx: Db, departmentId: number, code: string) {
  const stage = await tx.departmentStage.findUnique({ where: { departmentId_flow_code: { departmentId, flow: VISA_FLOW, code } } });
  if (!stage) throw new HttpError(500, "The visa steps are not set up. Run the database seed.");
  return stage;
}

/**
 * Enquiry → Documents, once: the first name or tick does it, as does "Start collecting documents". The stage is matched
 * in the update, so two changes at the same moment move it only once. Returns whether it moved.
 */
async function advanceToDocuments(tx: Db, enquiry: Step2Case, actor: Actor): Promise<boolean> {
  if (enquiry.stage.code !== "ENQUIRY") return false;
  const documents = await visaStage(tx, enquiry.departmentId, "DOCUMENTS");
  const moved = await tx.enquiry.updateMany({ where: { id: enquiry.id, stageId: enquiry.stageId }, data: { stageId: documents.id } });
  if (moved.count === 0) return false;
  await audit(
    {
      actorId: actor.user.id,
      action: "enquiry.stage",
      entityType: "Enquiry",
      entityId: enquiry.id,
      clientId: enquiry.clientId,
      before: { stage: "ENQUIRY" },
      after: { stage: "DOCUMENTS" },
      ip: actor.ip,
    },
    tx,
  );
  return true;
}

/** "Start collecting documents". */
export async function startDocuments(caseNo: string, actor: Actor) {
  const enquiry = await loadForStep2(caseNo, actor);
  if (enquiry.stage.code !== "ENQUIRY") throw conflict("Documents are already being collected for this case.");
  const moved = await prisma.$transaction(async (tx) => advanceToDocuments(tx, await lockForStep2(tx, enquiry.id, actor), actor));
  if (!moved) throw conflict("Documents are already being collected for this case.");
  return getVisaCaseById(enquiry.id);
}

/**
 * Ticks one paper (Decision 2): Original or Xerox for papers, Made for what we arrange, or Not needed; back to Pending
 * clears it. Each tick stamps who and when, to the minute; the audit log keeps the history.
 */
export async function updateDocument(caseNo: string, documentId: string, input: UpdateCaseDocumentInput, actor: Actor) {
  const enquiry = await loadForStep2(caseNo, actor);
  const doc = await prisma.visaCaseDocument.findFirst({ where: { id: documentId, traveller: { caseId: enquiry.id } } });
  if (!doc) throw notFound("Document not found on this case.");

  const arranged = doc.requirement === "ARRANGED_BY_US";
  if (input.status === "RECEIVED") {
    if (arranged) throw fieldError("status", "We arrange this one: mark it Made.");
    if (!input.receivedAs) throw fieldError("receivedAs", "Say whether the original or a xerox came in.");
  }
  if (input.status === "MADE" && !arranged) throw fieldError("status", "Only things we arrange are marked Made. Tick it as Original or Xerox.");

  const done = input.status === "RECEIVED" || input.status === "MADE";
  const receivedAs = input.status === "RECEIVED" ? (input.receivedAs ?? null) : null;

  await prisma.$transaction(async (tx) => {
    const locked = await lockForStep2(tx, enquiry.id, actor);
    // The paper as it is now, under the lock: someone may have ticked it while this request waited.
    const before = await tx.visaCaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    // Re-sending the same tick changes nothing (and doesn't move its time).
    if (before.status === input.status && before.receivedAs === receivedAs) return;
    const data = { status: input.status, receivedAs, receivedAt: done ? new Date() : null, receivedById: done ? actor.user.id : null };
    const after = await tx.visaCaseDocument.update({ where: { id: doc.id }, data });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.document.update",
        entityType: "VisaCaseDocument",
        entityId: doc.id,
        clientId: enquiry.clientId,
        before: { name: before.name, status: before.status, receivedAs: before.receivedAs, receivedAt: before.receivedAt, receivedById: before.receivedById },
        after: { name: after.name, status: after.status, receivedAs: after.receivedAs, receivedAt: after.receivedAt, receivedById: after.receivedById },
        ip: actor.ip,
      },
      tx,
    );
    await advanceToDocuments(tx, locked, actor);
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * How the documents reach us ("Client brings them" / "Send collection boy") and booklets received (Decision 4).
 * Booklets are optional (amended 10 Oct 2026). Only what changed is written and audited.
 */
export async function updateCase(caseNo: string, input: UpdateVisaCaseInput, actor: Actor) {
  const enquiry = await loadForStep2(caseNo, actor);

  await prisma.$transaction(async (tx) => {
    const locked = await lockForStep2(tx, enquiry.id, actor);
    const before = await tx.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id } });
    const changes = onlyChanged(definedOnly(input), before);
    const keys = Object.keys(changes);
    if (keys.length === 0) return;
    const after = await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: changes });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.case.update",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: pick(before, keys),
        after: pick(after, keys),
        ip: actor.ip,
      },
      tx,
    );
    await advanceToDocuments(tx, locked, actor);
  });
  return getVisaCaseById(enquiry.id);
}

const rethrowSameMember = rethrowUnique("This person is already a traveller on this case.");

/**
 * Names a traveller by linking the client's family member (Decision 3): it brings the passport and the consent. Picking
 * another member corrects a mistake. New people are added to the family first (POST /api/clients/:id/members).
 */
export async function linkTraveller(caseNo: string, travellerId: string, input: LinkTravellerInput, actor: Actor) {
  const enquiry = await loadForStep2(caseNo, actor);
  const found = await prisma.visaCaseTraveller.findFirst({ where: { id: travellerId, caseId: enquiry.id } });
  if (!found) throw notFound("Traveller not found on this case.");
  const member = await prisma.clientMember.findUnique({ where: { id: input.memberId } });
  if (!member || member.clientId !== enquiry.clientId) throw fieldError("memberId", "Pick someone from this client's family list.");
  if (member.archivedAt) throw fieldError("memberId", "This person was taken off the family list.");

  await prisma
    .$transaction(async (tx) => {
      const locked = await lockForStep2(tx, enquiry.id, actor);
      const traveller = await tx.visaCaseTraveller.findUniqueOrThrow({ where: { id: found.id } });
      if (traveller.memberId === member.id) return;
      const after = await tx.visaCaseTraveller.update({ where: { id: traveller.id }, data: { memberId: member.id, name: member.name } });
      await audit(
        {
          actorId: actor.user.id,
          action: "visa.traveller.link",
          entityType: "VisaCaseTraveller",
          entityId: traveller.id,
          clientId: enquiry.clientId,
          before: { memberId: traveller.memberId, name: traveller.name },
          after: { memberId: after.memberId, name: after.name },
          ip: actor.ip,
        },
        tx,
      );
      await advanceToDocuments(tx, locked, actor);
    })
    .catch(rethrowSameMember);
  return getVisaCaseById(enquiry.id);
}

/** What still stands between a case and maturity: unnamed travellers, and papers still pending, by traveller. */
async function missingForMaturity(db: Db, enquiryId: string) {
  const travellers = await db.visaCaseTraveller.findMany({
    where: { caseId: enquiryId },
    orderBy: { position: "asc" },
    include: { documents: { where: { status: "PENDING" }, orderBy: { sortOrder: "asc" }, select: { name: true } } },
  });
  const { adults } = countTravellers(travellers);
  const label = (t: (typeof travellers)[number]) => (t.memberId ? t.name : null) ?? travellerLabel(t, adults);
  return {
    unnamed: travellers.filter((t) => !t.memberId).map((t) => travellerLabel(t, adults)),
    pending: travellers.filter((t) => t.documents.length > 0).map((t) => ({ traveller: label(t), documents: t.documents.map((d) => d.name) })),
  };
}

/**
 * "Mark documents complete" (Decision 8): every traveller named and every paper in, made or not needed (booklets are
 * optional, amended 10 Oct 2026). The case moves to File preparation with no owner, "Matured · to assign", for the HOD
 * to give to a processor, who can't be the person who matured it. Returns the case by id: once its owner is cleared,
 * the staff member who pressed it may no longer be able to open it.
 *
 * The checklist is checked under the case's lock, in the same transaction as the move (lockForStep2), so a paper
 * un-ticked at the same moment either lands first and stops it, or waits and is then refused.
 */
export async function mature(caseNo: string, input: MatureCaseInput, actor: Actor) {
  const enquiry = await loadForStep2(caseNo, actor);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const locked = await lockForStep2(tx, enquiry.id, actor);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const missing = await missingForMaturity(tx, enquiry.id);
    if (missing.unnamed.length > 0 || missing.pending.length > 0) {
      const parts = [
        ...(missing.unnamed.length > 0 ? [`name ${missing.unnamed.join(", ")}`] : []),
        ...missing.pending.map((p) => `${p.traveller}: ${p.documents.join(", ")}`),
      ];
      throw new HttpError(409, `Not everything is in yet. Still needed: ${parts.join("; ")}.`, { code: "NOT_READY", missing });
    }

    const filePrep = await visaStage(tx, enquiry.departmentId, "FILE_PREPARATION");
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: filePrep.id, ownerId: null, dueAt: now } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { maturedAt: now, maturedById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.mature",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: locked.stage.code, ownerId: locked.ownerId, dueAt: locked.dueAt },
        after: { stage: "FILE_PREPARATION", ownerId: null, dueAt: now, maturedAt: now, maturedById: actor.user.id },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
