import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged, pick } from "../../lib/changes";
import { conflict, fieldError, HttpError, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import { VISA_FLOW } from "../enquiries/enquiries.seed";
import { assertCanActOnEnquiry, assertCanSeeEnquiry } from "../enquiries/visibility";
import type { Actor } from "../users/user";
import type { LinkTravellerInput, UpdateCaseDocumentInput, UpdateVisaCaseInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";

// Visa Step 2, part one (docs/decisions/0006-visa-documents.md Decisions 2, 3 and 8): naming travellers, ticking
// documents, how they reach us and booklets (Decision 4), and moving the case from Enquiry to Documents.

/** The steps where the checklist can still change. After maturity it is the processor's to check (Step 3). */
const COLLECTING = ["ENQUIRY", "DOCUMENTS"];

const caseInclude = { department: { select: { code: true } }, stage: true, visa: { select: { enquiryId: true } } } as const;

/** The case, if this user may change it and it is still collecting documents. */
async function loadForStep2(caseNo: string, actor: Actor) {
  const enquiry = await prisma.enquiry.findUnique({ where: { caseNo: caseNo.toUpperCase() }, include: caseInclude });
  if (!enquiry?.visa) throw notFound("Case not found.");
  assertCanSeeEnquiry(actor.user, enquiry);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status === "POSTPONED") throw conflict("This case is postponed. Resume it first.");
  if (enquiry.status !== "OPEN") throw conflict("This case is closed, so its documents can't change.");
  if (!COLLECTING.includes(enquiry.stage.code)) throw conflict("This case has moved past collecting documents.");
  return enquiry;
}

type Step2Case = Awaited<ReturnType<typeof loadForStep2>>;

/**
 * Enquiry → Documents, once: the first name or tick does it, as does "Start collecting documents". The stage is matched
 * in the update, so two changes at the same moment move it only once. Returns whether it moved.
 */
async function advanceToDocuments(tx: Db, enquiry: Step2Case, actor: Actor): Promise<boolean> {
  if (enquiry.stage.code !== "ENQUIRY") return false;
  const documents = await tx.departmentStage.findUnique({
    where: { departmentId_flow_code: { departmentId: enquiry.departmentId, flow: VISA_FLOW, code: "DOCUMENTS" } },
  });
  if (!documents) throw new HttpError(500, "The visa steps are not set up. Run the database seed.");
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
  const moved = await prisma.$transaction((tx) => advanceToDocuments(tx, enquiry, actor));
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
  // Re-sending the same tick changes nothing (and doesn't move its time).
  if (doc.status === input.status && doc.receivedAs === receivedAs) return getVisaCaseById(enquiry.id);

  const data = { status: input.status, receivedAs, receivedAt: done ? new Date() : null, receivedById: done ? actor.user.id : null };
  await prisma.$transaction(async (tx) => {
    const after = await tx.visaCaseDocument.update({ where: { id: doc.id }, data });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.document.update",
        entityType: "VisaCaseDocument",
        entityId: doc.id,
        clientId: enquiry.clientId,
        before: { name: doc.name, status: doc.status, receivedAs: doc.receivedAs, receivedAt: doc.receivedAt, receivedById: doc.receivedById },
        after: { name: after.name, status: after.status, receivedAs: after.receivedAs, receivedAt: after.receivedAt, receivedById: after.receivedById },
        ip: actor.ip,
      },
      tx,
    );
    await advanceToDocuments(tx, enquiry, actor);
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * How the documents reach us ("Client brings them" / "Send collection boy") and booklets received (Decision 4).
 * Booklets are optional (amended 10 Oct 2026). Only what changed is written and audited.
 */
export async function updateCase(caseNo: string, input: UpdateVisaCaseInput, actor: Actor) {
  const enquiry = await loadForStep2(caseNo, actor);
  const before = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id } });
  const changes = onlyChanged(definedOnly(input), before);
  const keys = Object.keys(changes);
  if (keys.length === 0) return getVisaCaseById(enquiry.id);

  await prisma.$transaction(async (tx) => {
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
    await advanceToDocuments(tx, enquiry, actor);
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
  const traveller = await prisma.visaCaseTraveller.findFirst({ where: { id: travellerId, caseId: enquiry.id } });
  if (!traveller) throw notFound("Traveller not found on this case.");
  const member = await prisma.clientMember.findUnique({ where: { id: input.memberId } });
  if (!member || member.clientId !== enquiry.clientId) throw fieldError("memberId", "Pick someone from this client's family list.");
  if (member.archivedAt) throw fieldError("memberId", "This person was taken off the family list.");
  if (traveller.memberId === member.id) return getVisaCaseById(enquiry.id);

  await prisma
    .$transaction(async (tx) => {
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
      await advanceToDocuments(tx, enquiry, actor);
    })
    .catch(rethrowSameMember);
  return getVisaCaseById(enquiry.id);
}
