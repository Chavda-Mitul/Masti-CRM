import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fileNamePart } from "../../lib/fileNames";
import { conflict, notFound } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { MB, pdfPageCount, tooBigMessage } from "../../lib/pdf";
import { deleteObject, putObject } from "../../lib/storage";
import type { Actor } from "../users/user";
import { CHECKING_EVISA, loadCase, lockCase } from "./caseLock";
import type { SetEvisaCheckInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, evisaMaxMb, travellerLabel } from "./visaCase";

// E-visas after the decision, part 1 (docs/decisions/0025-evisa-after-decision.md): at Decision, each approved
// traveller's e-visa, as the portal issued it, is kept as one PDF with the case's files in the private bucket (rule 4),
// then checked against the passport and what was recorded at Step 6: Matches or Doesn't match. The check reuses the
// sticker's (VisaCaseTraveller.stickerCheck): an e-visa never reaches Step 7, where a sticker is checked. A newer
// upload is the current one, older ones stay as proof, and a newer upload clears the check: it needs a new look. By
// whoever can act on the case, while it's open. Opened like any case file (openCaseFile).

/** The traveller, if the case is an e-visa and they're on it and approved, with the name the case shows them by. */
async function approvedTraveller(db: Db, enquiryId: string, travellerId: string) {
  const visa = await db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedOnlineAt: true,
      travellers: { select: { id: true, position: true, isChild: true, name: true, outcome: true, stickerCheck: true } },
    },
  });
  if (!visa.submittedOnlineAt) throw conflict("This visa has a sticker, not an e-visa: it's checked when the passports come back.");
  const t = visa.travellers.find((x) => x.id === travellerId);
  if (!t) throw notFound("Traveller not found on this case.");
  const label = t.name ?? travellerLabel(t, countTravellers(visa.travellers).adults);
  if (t.outcome !== "APPROVED") throw conflict(`${label} wasn't approved, so there's no e-visa to add.`);
  return { ...t, label };
}

/** The traveller's current e-visa: the newest upload. */
function currentEvisa(db: Db, travellerId: string) {
  return db.caseFile.findFirst({
    where: { travellerId, kind: "EVISA" },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    select: { id: true, fileName: true },
  });
}

/**
 * Before the upload is read: the case must be one this user may change once decided, an e-visa, the traveller
 * approved; the limit is WhatsApp's, or the final file's if lower (evisaMaxMb). Refusing here means a wrong upload is
 * never held in memory.
 */
export async function evisaLimit(caseNo: string, travellerId: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CHECKING_EVISA);
  await approvedTraveller(prisma, enquiry.id, travellerId);
  const maxMb = evisaMaxMb((await getVisaSettings()).finalFile.maxMb);
  return { maxBytes: maxMb * MB, tooBig: tooBigMessage(maxMb) };
}

/** "VISA-2026-0001_Aarav-Mehta_evisa.pdf" ⚠️: the case number and the traveller's name, letters and digits only. */
function evisaFileName(caseNo: string, name: string) {
  const safe = fileNamePart(name);
  return safe ? `${caseNo}_${safe}_evisa.pdf` : `${caseNo}_evisa.pdf`;
}

/**
 * Saves an approved traveller's e-visa: one real PDF, its pages counted, in the private bucket under a key no other
 * upload shares. The key ends in the file's name, so the link the client's WhatsApp gets (part 2) shows it. The bucket
 * upload happens before the case lock, so a slow upload never holds the case. Under the lock the checks are repeated;
 * if they fail now, the row isn't saved and the object is removed again. The traveller's check is cleared: the new PDF
 * hasn't been looked at.
 */
export async function uploadEvisa(caseNo: string, travellerId: string, bytes: Buffer, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CHECKING_EVISA);
  const pageCount = await pdfPageCount(bytes);
  const t = await approvedTraveller(prisma, enquiry.id, travellerId);
  const fileName = evisaFileName(enquiry.caseNo, t.label);
  const storageKey = `cases/${enquiry.id}/evisa/${randomUUID()}/${fileName}`;
  await putObject(storageKey, bytes, "application/pdf");

  try {
    await prisma.$transaction(async (tx) => {
      await lockCase(tx, enquiry.id, actor, CHECKING_EVISA);
      const traveller = await approvedTraveller(tx, enquiry.id, travellerId);
      const previous = await currentEvisa(tx, travellerId);
      const file = await tx.caseFile.create({
        data: {
          enquiryId: enquiry.id,
          kind: "EVISA",
          travellerId,
          storageKey,
          fileName,
          sizeBytes: bytes.length,
          pageCount,
          uploadedById: actor.user.id,
        },
      });
      if (traveller.stickerCheck) await tx.visaCaseTraveller.update({ where: { id: travellerId }, data: { stickerCheck: null } });
      await audit(
        {
          actorId: actor.user.id,
          action: "visa.file.upload",
          entityType: "CaseFile",
          entityId: file.id,
          clientId: enquiry.clientId,
          after: {
            kind: file.kind,
            traveller: traveller.label,
            fileName,
            sizeBytes: file.sizeBytes,
            pageCount,
            storageKey,
            replaces: previous?.id ?? null,
            checkCleared: traveller.stickerCheck,
          },
          ip: actor.ip,
        },
        tx,
      );
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
  return getVisaCaseById(enquiry.id);
}

/**
 * The traveller's current e-visa checked against the passport and what was recorded at Step 6: Matches, Doesn't match,
 * or null to undo a mis-click. Refused unless the PDF looked at is still the current one. Like the processor's paper
 * checks (0007 Decision 3), it doesn't move the case's updatedAt, so it never makes someone else's open page stale.
 * Saving the same check again writes nothing.
 */
export async function setEvisaCheck(caseNo: string, travellerId: string, input: SetEvisaCheckInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CHECKING_EVISA);
  const check = async (db: Db) => {
    const t = await approvedTraveller(db, enquiry.id, travellerId);
    const file = await currentEvisa(db, travellerId);
    if (!file) throw conflict(`Upload ${t.label}'s e-visa first, then check it.`);
    if (file.id !== input.fileId) throw conflict("A newer e-visa was uploaded: open it and check again.");
    return { t, file };
  };
  await check(prisma);

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, CHECKING_EVISA);
    const { t, file } = await check(tx);
    if (t.stickerCheck === input.check) return;
    await tx.visaCaseTraveller.update({ where: { id: travellerId }, data: { stickerCheck: input.check } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.evisa.check",
        entityType: "VisaCaseTraveller",
        entityId: travellerId,
        clientId: enquiry.clientId,
        before: { traveller: t.label, check: t.stickerCheck },
        after: { traveller: t.label, check: input.check, fileId: file.id, fileName: file.fileName },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
