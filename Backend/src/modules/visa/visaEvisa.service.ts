import { randomUUID } from "node:crypto";
import type { EnquiryStatus } from "../../../generated/prisma/enums";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fileNamePart } from "../../lib/fileNames";
import { conflict, notFound } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { deleteObject, putObject } from "../../lib/storage";
import type { ScanType } from "../clients/clients.schemas";
import type { Actor } from "../users/user";
import { EVISA_FILES, loadCase, lockCase } from "./caseLock";
import { decisionFileLimit, travellerFilePdf } from "./travellerFiles";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";
import { evisasAllIn, evisaState, finishEvisas } from "./visaEvisaDone";
import { queueTravellerFileMessage } from "./visaMessages";

// E-visas after the decision (docs/decisions/0025-evisa-after-decision.md): each approved traveller's e-visa, as the
// portal issued it, or a photo of it turned into a one-page PDF (change request 21 part 2, travellerFiles.ts), is kept
// as one PDF with the case's files in the private bucket (rule 4), and goes to the client on WhatsApp as soon as it's
// uploaded (message 19; change request 21 part 3: no check, no "Send the e-visa"). The upload that sends the last
// approved traveller's finishes the case (visaEvisaDone.ts). A newer upload is the current one and goes too; older
// ones stay as proof. After that, a corrected e-visa can still be uploaded and sent: it changes nothing else. By
// whoever can act on the case. Opened like any case file (openCaseFile).

/**
 * The traveller, if the case is an e-visa and they're on it and approved, with the name the case shows them by. Until
 * every approved e-visa has gone, the case must be open: the last upload moves it on.
 */
async function approvedTraveller(db: Db, enquiry: { id: string; status: EnquiryStatus }, travellerId: string) {
  const visa = await db.visaCase.findUniqueOrThrow({
    where: { enquiryId: enquiry.id },
    select: {
      submittedOnlineAt: true,
      evisaSentAt: true,
      travellers: { select: { id: true, position: true, isChild: true, name: true, outcome: true } },
    },
  });
  if (!visa.submittedOnlineAt) throw conflict("This visa has a sticker, not an e-visa: it's checked when the passports come back.");
  if (!visa.evisaSentAt) {
    if (enquiry.status === "POSTPONED") throw conflict("This case is postponed. Resume it first.");
    if (enquiry.status !== "OPEN") throw conflict("This case is closed, so it can't change.");
  }
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
    select: { id: true },
  });
}

/**
 * Before the upload is read: the case must be one this user may change once decided, an e-visa, the traveller
 * approved; the limit is the decision files' (travellerFiles.ts). Refusing here means a wrong upload is never held in
 * memory.
 */
export async function evisaLimit(caseNo: string, travellerId: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, EVISA_FILES);
  await approvedTraveller(prisma, enquiry, travellerId);
  return decisionFileLimit((await getVisaSettings()).finalFile.maxMb);
}

/** "VISA-2026-0001_Aarav-Mehta_evisa.pdf" ⚠️: the case number and the traveller's name, letters and digits only. */
function evisaFileName(caseNo: string, name: string) {
  const safe = fileNamePart(name);
  return safe ? `${caseNo}_${safe}_evisa.pdf` : `${caseNo}_evisa.pdf`;
}

/**
 * Saves an approved traveller's e-visa: one real PDF (a photo turned into one), its pages counted, in the private
 * bucket under a key no other upload shares, and sends it to the client (message 19) in the same transaction. The key
 * ends in the file's name, as a WhatsApp document's name once came from its link. The bucket upload happens before the
 * case lock, so a slow upload never holds the case. Under the lock the checks are repeated; if they fail now, the row
 * isn't saved, nothing is sent and the object is removed again. When this was the last approved traveller's e-visa,
 * the case is finished: Delivered and closed, or due for the passports' handover.
 */
export async function uploadEvisa(caseNo: string, travellerId: string, contentType: ScanType, bytes: Buffer, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, EVISA_FILES);
  const { pdf, pageCount, photo } = await travellerFilePdf(bytes, contentType, (await getVisaSettings()).finalFile.maxMb);
  const t = await approvedTraveller(prisma, enquiry, travellerId);
  const fileName = evisaFileName(enquiry.caseNo, t.label);
  const storageKey = `cases/${enquiry.id}/evisa/${randomUUID()}/${fileName}`;
  await putObject(storageKey, pdf, "application/pdf");

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await lockCase(tx, enquiry.id, actor, EVISA_FILES);
      const traveller = await approvedTraveller(tx, locked, travellerId);
      const previous = await currentEvisa(tx, travellerId);
      const file = await tx.caseFile.create({
        data: {
          enquiryId: enquiry.id,
          kind: "EVISA",
          travellerId,
          storageKey,
          fileName,
          sizeBytes: pdf.length,
          pageCount,
          uploadedById: actor.user.id,
        },
      });
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
            // Sent as a photo, and kept as the PDF it made.
            ...(photo ? { photo } : {}),
          },
          ip: actor.ip,
        },
        tx,
      );
      await queueTravellerFileMessage(tx, enquiry.id, { id: file.id, kind: "EVISA", travellerName: traveller.label });
      // The last approved traveller's e-visa has gone: the case moves on, as "Send the e-visa" once moved it.
      const state = await evisaState(tx, enquiry.id);
      if (evisasAllIn(state)) await finishEvisas(tx, locked, state, actor);
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
  return getVisaCaseById(enquiry.id);
}
