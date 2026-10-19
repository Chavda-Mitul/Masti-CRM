import type { VisaCaseDocument } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit, auditMany } from "../../lib/audit";
import { assertFresh, definedOnly, onlyChanged, pick } from "../../lib/changes";
import { fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { badRequest, conflict, fieldError, HttpError, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import { currentScan } from "../clients/clientDocuments.service";
import type { Actor } from "../users/user";
import { COLLECTING, loadCase, lockCase, TRIP, visaStage, type LockedCase } from "./caseLock";
import type { LinkTravellerInput, MatureCaseInput, SetRemindersInput, UpdateCaseDocumentInput, UpdateTripInput, UpdateVisaCaseInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";

// Visa Step 2, part one (docs/decisions/0006-visa-documents.md Decisions 2, 3 and 8): naming travellers, ticking
// documents, how they reach us and booklets (Decision 4), moving the case from Enquiry to Documents, and maturity.

/**
 * Enquiry → Documents, once: the first name or tick does it, as does "Start collecting documents". The stage is matched
 * in the update, so two changes at the same moment move it only once. Returns whether it moved.
 */
export async function advanceToDocuments(
  tx: Db,
  enquiry: Pick<LockedCase, "id" | "stageId" | "departmentId" | "clientId"> & { stage: { code: string } },
  actor: Actor,
): Promise<boolean> {
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
  const enquiry = await loadCase(caseNo, actor, COLLECTING);
  if (enquiry.stage.code !== "ENQUIRY") throw conflict("Documents are already being collected for this case.");
  const moved = await prisma.$transaction(async (tx) => advanceToDocuments(tx, await lockCase(tx, enquiry.id, actor, COLLECTING), actor));
  if (!moved) throw conflict("Documents are already being collected for this case.");
  return getVisaCaseById(enquiry.id);
}

/** A paper's tick, for the audit log. */
const tickOf = (d: VisaCaseDocument) => ({
  name: d.name,
  status: d.status,
  receivedAs: d.receivedAs,
  clientDocumentId: d.clientDocumentId,
  receivedAt: d.receivedAt,
  receivedById: d.receivedById,
});

/**
 * The scan an On file tick uses (0016 Decision 5): the current copy of the paper for the traveller's person in the
 * client's vault, picked under the case's lock. Refusals are plain 400s, so the checklist's toast says why.
 */
async function copyOnFile(db: Db, doc: VisaCaseDocument) {
  const traveller = await db.visaCaseTraveller.findUniqueOrThrow({ where: { id: doc.travellerId }, select: { memberId: true, name: true } });
  if (!traveller.memberId) throw badRequest("Name the traveller first: copies on file are kept per person.");
  const scan = await currentScan(db, traveller.memberId, doc.documentId);
  if (!scan) throw badRequest(`There's no copy of "${doc.name}" on file for ${traveller.name ?? "this traveller"}.`);
  return scan.id;
}

/**
 * Ticks one paper (Decision 2): Original or Xerox for papers, Made for what we arrange, or Not needed; back to Pending
 * clears it. A paper that may be a xerox can also be On file: printed from the current copy in the client's vault, which
 * the paper then names (0016 Decision 5). Each tick stamps who and when, to the minute; the audit log keeps the history.
 */
export async function updateDocument(caseNo: string, documentId: string, input: UpdateCaseDocumentInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, COLLECTING);
  const doc = await prisma.visaCaseDocument.findFirst({ where: { id: documentId, traveller: { caseId: enquiry.id } } });
  if (!doc) throw notFound("Document not found on this case.");

  const arranged = doc.requirement === "ARRANGED_BY_US";
  if (input.status === "RECEIVED") {
    if (arranged) throw fieldError("status", "We arrange this one: mark it Made.");
    if (!input.receivedAs) throw fieldError("receivedAs", "Say whether the original or a xerox came in.");
    if (input.receivedAs === "ON_FILE" && doc.requirement !== "XEROX_OK") {
      throw badRequest("Only papers that may be a xerox can come from the copy on file.");
    }
  }
  if (input.status === "MADE" && !arranged) throw fieldError("status", "Only things we arrange are marked Made. Tick it as Original or Xerox.");

  const done = input.status === "RECEIVED" || input.status === "MADE";
  const receivedAs = input.status === "RECEIVED" ? (input.receivedAs ?? null) : null;

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, COLLECTING);
    // The paper as it is now, under the lock: someone may have ticked it while this request waited.
    const before = await tx.visaCaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const clientDocumentId = receivedAs === "ON_FILE" ? await copyOnFile(tx, before) : null;
    // Re-sending the same tick changes nothing (and doesn't move its time). On file again after a newer scan moves to it.
    if (before.status === input.status && before.receivedAs === receivedAs && before.clientDocumentId === clientDocumentId) return;
    const data = {
      status: input.status,
      receivedAs,
      clientDocumentId,
      receivedAt: done ? new Date() : null,
      receivedById: done ? actor.user.id : null,
    };
    const after = await tx.visaCaseDocument.update({ where: { id: doc.id }, data });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.document.update",
        entityType: "VisaCaseDocument",
        entityId: doc.id,
        clientId: enquiry.clientId,
        before: tickOf(before),
        after: tickOf(after),
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
  const enquiry = await loadCase(caseNo, actor, COLLECTING);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, COLLECTING);
    const before = await tx.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id } });
    const changes = onlyChanged(definedOnly(input), before);
    // The collection boy is booked (0015): call him off first, so nobody goes for papers the client brings.
    if (changes.arrival === "CLIENT_BRINGS" && (await tx.fieldJob.count({ where: { enquiryId: enquiry.id, kind: "PICKUP", status: "BOOKED" } })) > 0) {
      throw conflict("Cancel the collection boy's pickup first.");
    }
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

/**
 * The Reminders card's On/Off (0006 amendment 19): the owner, the Visa HOD or the Head, while documents are collected.
 * Audited when it changes.
 */
export async function setReminders(caseNo: string, input: SetRemindersInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, COLLECTING);
  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, COLLECTING);
    const before = await tx.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id }, select: { remindersOn: true } });
    if (before.remindersOn === input.on) return;
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { remindersOn: input.on } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.reminders.update",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { remindersOn: before.remindersOn },
        after: { remindersOn: input.on },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

const dbDate = (value: string | null | undefined) => (value == null ? value : toDbDate(value));

/** The trip as the audit log shows it: dates as plain days. */
function tripView(row: { departOn: Date | null; returnOn: Date | null; entryType: string | null; hotelStay: string | null }) {
  return {
    departOn: row.departOn && fromDbDate(row.departOn),
    returnOn: row.returnOn && fromDbDate(row.returnOn),
    entryType: row.entryType,
    hotelStay: row.hotelStay,
  };
}

/**
 * Trip details (docs/decisions/0007-visa-file-prep.md Decision 4): travelling out, coming back, the entry type and the
 * hotel stay. Captured as the documents come in and corrected during file preparation; like any Step 2 change, the
 * first one moves the case from Enquiry to Documents. Only what changed is written and audited. A newly set travelling
 * out can't be in the past, and coming back is checked against travelling out as stored, so one date alone is checked
 * too. Like ticks, it doesn't change the case's updatedAt.
 */
export async function updateTrip(caseNo: string, input: UpdateTripInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, TRIP);
  const sent = definedOnly({ ...input, departOn: dbDate(input.departOn), returnOn: dbDate(input.returnOn) });

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, TRIP);
    const before = await tx.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id } });
    const changes = onlyChanged(sent, before);
    const keys = Object.keys(changes);
    if (keys.length === 0) return;

    if (changes.departOn && fromDbDate(changes.departOn) < istToday()) {
      throw fieldError("departOn", "Travelling out can't be in the past.");
    }
    const departOn = changes.departOn !== undefined ? changes.departOn : before.departOn;
    const returnOn = changes.returnOn !== undefined ? changes.returnOn : before.returnOn;
    if (departOn && returnOn && returnOn < departOn) throw fieldError("returnOn", "Coming back can't be before travelling out.");

    const after = await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: changes });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.trip.update",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: pick(tripView(before), keys),
        after: pick(tripView(after), keys),
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
  const enquiry = await loadCase(caseNo, actor, COLLECTING);
  const found = await prisma.visaCaseTraveller.findFirst({ where: { id: travellerId, caseId: enquiry.id } });
  if (!found) throw notFound("Traveller not found on this case.");
  const member = await prisma.clientMember.findUnique({ where: { id: input.memberId } });
  if (!member || member.clientId !== enquiry.clientId) throw fieldError("memberId", "Pick someone from this client's family list.");
  if (member.archivedAt) throw fieldError("memberId", "This person was taken off the family list.");

  await prisma
    .$transaction(async (tx) => {
      const locked = await lockCase(tx, enquiry.id, actor, COLLECTING);
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
      // Papers ticked On file came from the other person's copies (0016 Decision 5): they go back to Pending.
      const onFile = await tx.visaCaseDocument.findMany({ where: { travellerId: traveller.id, receivedAs: "ON_FILE" } });
      if (onFile.length > 0) {
        const pending = { status: "PENDING" as const, receivedAs: null, clientDocumentId: null, receivedAt: null, receivedById: null };
        await tx.visaCaseDocument.updateMany({ where: { id: { in: onFile.map((d) => d.id) } }, data: pending });
        await auditMany(
          onFile.map((d) => ({
            actorId: actor.user.id,
            action: "visa.document.update",
            entityType: "VisaCaseDocument",
            entityId: d.id,
            clientId: enquiry.clientId,
            before: tickOf(d),
            after: tickOf({ ...d, ...pending }),
            ip: actor.ip,
          })),
          tx,
        );
      }
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
 * to give to a processor, who can't be the person who matured it. It's due the next open office day at 11:00 ⚠️
 * (visa.assignCheck, amended 16 Oct 2026), so it isn't late the moment it's handed over. Returns the case by id: once its owner is cleared,
 * the staff member who pressed it may no longer be able to open it.
 *
 * The checklist is checked under the case's lock, in the same transaction as the move (lockCase), so a paper
 * un-ticked at the same moment either lands first and stops it, or waits and is then refused.
 */
export async function mature(caseNo: string, input: MatureCaseInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, COLLECTING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, COLLECTING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const missing = await missingForMaturity(tx, enquiry.id);
    if (missing.unnamed.length > 0 || missing.pending.length > 0) {
      const parts = [
        ...(missing.unnamed.length > 0 ? [`name ${missing.unnamed.join(", ")}`] : []),
        ...missing.pending.map((p) => `${p.traveller}: ${p.documents.join(", ")}`),
      ];
      throw new HttpError(409, `Not everything is in yet. Still needed: ${parts.join("; ")}.`, { code: "NOT_READY", missing });
    }
    // The boy mustn't go for papers that are all in (0015): the office calls him off first, as for "Client brings them".
    const pickup = await tx.fieldJob.findFirst({ where: { enquiryId: enquiry.id, kind: "PICKUP", status: "BOOKED" }, select: { id: true } });
    if (pickup) throw conflict("The collection boy is still booked for this case. Cancel his pickup first.");

    const filePrep = await visaStage(tx, enquiry.departmentId, "FILE_PREPARATION");
    const dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).assignCheck, tx);
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: filePrep.id, ownerId: null, dueAt } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { maturedAt: now, maturedById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.mature",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: locked.stage.code, ownerId: locked.ownerId, dueAt: locked.dueAt },
        after: { stage: "FILE_PREPARATION", ownerId: null, dueAt, maturedAt: now, maturedById: actor.user.id },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
