import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, fieldError, notFound } from "../../lib/httpError";
import { deleteObject, presignGet, putObject } from "../../lib/storage";
import { assertCanSeeEnquiry } from "../enquiries/visibility";
import type { Actor } from "../users/user";
import { loadCase, lockCase, PREPARING } from "./caseLock";
import type { CheckCaseDocumentInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";

// Visa Step 3, file preparation (docs/decisions/0007-visa-file-prep.md): the processor's check of each paper, and the
// saved file. Every write locks the case first (caseLock.ts), so "File ready" and a change here take turns.

/**
 * The processor checks one paper again (Decision 3): Checked, or Needs replacing with a reason from the master list.
 * Each stamps who and when, to the minute; Checked clears the reason, and null sets the paper back to "to check".
 * Step 2's receipt (Original/Xerox, who received it and when) is left as it was. The audit log keeps the history.
 */
export async function checkDocument(caseNo: string, documentId: string, input: CheckCaseDocumentInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const doc = await prisma.visaCaseDocument.findFirst({ where: { id: documentId, traveller: { caseId: enquiry.id } } });
  if (!doc) throw notFound("Document not found on this case.");
  // Papers are frozen after maturity, so this can't change while the request waits for the lock.
  if (doc.status !== "RECEIVED" && doc.status !== "MADE") {
    throw fieldError("check", "Only papers that came in, or that we made, are checked.");
  }

  const reasonId = input.check === "NEEDS_REPLACING" ? (input.reasonId ?? null) : null;

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, PREPARING);
    // The paper as it is now, under the lock: someone may have checked it while this request waited.
    const before = await tx.visaCaseDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { checkReason: true } });
    // Re-sending the same check changes nothing (and doesn't move its time).
    if (before.check === input.check && before.checkReasonId === reasonId) return;
    if (reasonId !== null) {
      const reason = await tx.documentProblemReason.findUnique({ where: { id: reasonId } });
      if (!reason?.isActive) throw fieldError("reasonId", "Pick a reason from the list.");
    }

    const now = input.check ? new Date() : null;
    const after = await tx.visaCaseDocument.update({
      where: { id: doc.id },
      data: { check: input.check, checkReasonId: reasonId, checkedAt: now, checkedById: input.check ? actor.user.id : null },
      include: { checkReason: true },
    });
    const snapshot = (d: typeof after) => ({
      name: d.name,
      check: d.check,
      checkReasonId: d.checkReasonId,
      reason: d.checkReason?.name ?? null,
      checkedAt: d.checkedAt,
      checkedById: d.checkedById,
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.document.check",
        entityType: "VisaCaseDocument",
        entityId: doc.id,
        clientId: enquiry.clientId,
        before: snapshot(before),
        after: snapshot(after),
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

// ---------------------------------------------------------------------------
// The saved file, kept as proof (Decision 8)
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
const PDF_MAGIC = Buffer.from("%PDF-");

/**
 * Before the upload is read: the case must be one this user may change at File preparation, and the setting gives
 * the size limit. Refusing here means a wrong upload is never held in memory.
 */
export async function finalFileLimit(caseNo: string, actor: Actor) {
  await loadCase(caseNo, actor, PREPARING);
  const { maxMb } = (await getVisaSettings()).finalFile;
  return { maxBytes: maxMb * MB, tooBig: `This PDF is over ${maxMb} MB. Scan it at a lower resolution and upload it again.` };
}

/** "VISA-2026-0001_Mehta_file.pdf" ⚠️ (demo screen 08): the case number and the client's last name, letters and digits only. */
function finalFileName(caseNo: string, clientName: string) {
  const last = clientName.trim().split(/\s+/).at(-1) ?? "";
  const safe = last.normalize("NFKD").replace(/[^A-Za-z0-9-]/g, "");
  return safe ? `${caseNo}_${safe}_file.pdf` : `${caseNo}_file.pdf`;
}

/**
 * Saves the final file: one PDF, every page as it went to the vendor. It must really be a PDF (it starts with %PDF-
 * and opens), its pages are counted, and it goes to the private bucket under a key no other upload shares. The newest
 * upload is the current file; older ones are kept as proof. Allowed during File preparation only.
 *
 * The bucket upload happens before the case lock, so a slow upload never holds the case. Under the lock the checks are
 * repeated; if the case moved on meanwhile, the row isn't saved and the object is removed again.
 */
export async function uploadFinalFile(caseNo: string, bytes: Buffer, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  if (bytes.length === 0) throw badRequest("Pick the PDF to upload.");
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw badRequest("This isn't a PDF. Save the scan as a PDF and upload that.");
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    throw badRequest("This PDF can't be opened. Save it again and upload the new copy.");
  }
  if (pageCount === 0) throw badRequest("This PDF has no pages.");

  const client = await prisma.client.findUniqueOrThrow({ where: { id: enquiry.clientId }, select: { name: true } });
  const fileName = finalFileName(enquiry.caseNo, client.name);
  const storageKey = `cases/${enquiry.id}/final/${randomUUID()}.pdf`;
  await putObject(storageKey, bytes, "application/pdf");

  try {
    await prisma.$transaction(async (tx) => {
      await lockCase(tx, enquiry.id, actor, PREPARING);
      const previous = await tx.caseFile.findFirst({
        where: { enquiryId: enquiry.id, kind: "FINAL_FILE" },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const file = await tx.caseFile.create({
        data: { enquiryId: enquiry.id, kind: "FINAL_FILE", storageKey, fileName, sizeBytes: bytes.length, pageCount, uploadedById: actor.user.id },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "visa.file.upload",
          entityType: "CaseFile",
          entityId: file.id,
          clientId: enquiry.clientId,
          after: { kind: file.kind, fileName, sizeBytes: file.sizeBytes, pageCount, storageKey, replaces: previous?.id ?? null },
          ip: actor.ip,
        },
        tx,
      );
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => console.error(`Couldn't remove unsaved upload ${storageKey}:`, cleanupErr));
    throw err;
  }
  return getVisaCaseById(enquiry.id);
}

/**
 * A short-lived link to one of the case's files, for anyone who can open the case. Opening is audited: the file holds
 * passports and personal papers (golden rule 5).
 */
export async function openCaseFile(caseNo: string, fileId: string, actor: Actor) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { caseNo: caseNo.toUpperCase() },
    include: { department: { select: { code: true } }, visa: { select: { enquiryId: true } } },
  });
  if (!enquiry?.visa) throw notFound("Case not found.");
  assertCanSeeEnquiry(actor.user, enquiry);
  const file = await prisma.caseFile.findFirst({ where: { id: fileId, enquiryId: enquiry.id } });
  if (!file) throw notFound("File not found on this case.");

  const link = await presignGet(file.storageKey, { fileName: file.fileName });
  await audit({
    actorId: actor.user.id,
    action: "visa.file.open",
    entityType: "CaseFile",
    entityId: file.id,
    clientId: enquiry.clientId,
    after: { fileName: file.fileName, expiresAt: link.expiresAt },
    ip: actor.ip,
  });
  return link;
}
