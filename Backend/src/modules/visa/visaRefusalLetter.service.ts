import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { conflict, notFound } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { deleteObject, putObject } from "../../lib/storage";
import type { Actor } from "../users/user";
import { LETTERS, loadCase, lockCase } from "./caseLock";
import { MB, pdfPageCount, tooBigMessage } from "./casePdf";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";

// Visa Step 6, the refusal letter (docs/decisions/0012-visa-decision.md Decision 4): a refused traveller's letter,
// scanned as one PDF and kept with the case's files in the private bucket (rule 4). Optional, and added any time once
// the traveller is refused, whatever the case's status: it often comes back inside the passport. A newer upload is the
// current one; older ones stay as proof. A traveller changed to Approved keeps their letters, which the case then
// doesn't show. Opened like any case file (openCaseFile).

/** The traveller, if they're on the case and refused, with the name the case shows them by. */
async function refusedTraveller(db: Db, enquiryId: string, travellerId: string) {
  const travellers = await db.visaCaseTraveller.findMany({
    where: { caseId: enquiryId },
    select: { id: true, position: true, isChild: true, name: true, outcome: true },
  });
  const t = travellers.find((x) => x.id === travellerId);
  if (!t) throw notFound("Traveller not found on this case.");
  const name = t.name ?? travellerLabel(t, countTravellers(travellers).adults);
  if (t.outcome !== "REFUSED") throw conflict(`${name} wasn't refused, so there's no refusal letter to add.`);
  return { ...t, label: name };
}

/**
 * Before the upload is read: the case must be one this user may change once decided, the traveller refused, and the
 * setting gives the size limit (the final file's, visa.finalFile.maxMb). Refusing here means a wrong upload is never
 * held in memory.
 */
export async function refusalLetterLimit(caseNo: string, travellerId: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, LETTERS);
  await refusedTraveller(prisma, enquiry.id, travellerId);
  const { maxMb } = (await getVisaSettings()).finalFile;
  return { maxBytes: maxMb * MB, tooBig: tooBigMessage(maxMb) };
}

/** "VISA-2026-0001_Aarav-Mehta_refusal.pdf" ⚠️: the case number and the traveller's name, letters and digits only. */
function letterFileName(caseNo: string, name: string) {
  const safe = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return safe ? `${caseNo}_${safe}_refusal.pdf` : `${caseNo}_refusal.pdf`;
}

/**
 * Saves a refused traveller's refusal letter: one real PDF, its pages counted, in the private bucket under a key no
 * other upload shares. The bucket upload happens before the case lock, so a slow upload never holds the case. Under the
 * lock the checks are repeated; if they fail now, the row isn't saved and the object is removed again.
 */
export async function uploadRefusalLetter(caseNo: string, travellerId: string, bytes: Buffer, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, LETTERS);
  const pageCount = await pdfPageCount(bytes);
  const t = await refusedTraveller(prisma, enquiry.id, travellerId);
  const fileName = letterFileName(enquiry.caseNo, t.label);
  const storageKey = `cases/${enquiry.id}/refusal/${randomUUID()}.pdf`;
  await putObject(storageKey, bytes, "application/pdf");

  try {
    await prisma.$transaction(async (tx) => {
      await lockCase(tx, enquiry.id, actor, LETTERS);
      const traveller = await refusedTraveller(tx, enquiry.id, travellerId);
      const previous = await tx.caseFile.findFirst({
        where: { travellerId, kind: "REFUSAL_LETTER" },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const file = await tx.caseFile.create({
        data: {
          enquiryId: enquiry.id,
          kind: "REFUSAL_LETTER",
          travellerId,
          storageKey,
          fileName,
          sizeBytes: bytes.length,
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
