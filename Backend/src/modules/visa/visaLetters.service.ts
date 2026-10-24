import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fileNamePart } from "../../lib/fileNames";
import { conflict, notFound } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { deleteObject, putObject } from "../../lib/storage";
import type { ScanType } from "../clients/clients.schemas";
import type { Actor } from "../users/user";
import { LETTERS, loadCase, lockCase, VISA_COPIES, type StepRule } from "./caseLock";
import { decisionFileLimit, travellerFilePdf } from "./travellerFiles";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";

// Visa Step 6, a traveller's letter (docs/decisions/0012-visa-decision.md): a refused traveller's refusal letter
// (Decision 4), or an approved paper visa's visa copy, the passport's visa page or the approval letter (amended 24 Oct
// 2026, change request 21, part 2). Kept as one PDF with the case's files in the private bucket (rule 4); a photo
// becomes a one-page PDF (travellerFiles.ts). Optional, and added any time once decided, whatever the case's status: a
// letter often comes back inside the passport. A newer upload is the current one; older ones stay as proof. A
// traveller whose outcome changes keeps their files, which the case then doesn't show. Opened like any case file
// (openCaseFile).

export type LetterKind = "REFUSAL_LETTER" | "VISA_COPY";

/** When each letter can be added, what it needs of its traveller, and what it's called ⚠️. */
const KINDS: Record<LetterKind, { rule: StepRule; outcome: "REFUSED" | "APPROVED"; folder: string; suffix: string; notDecided: (name: string) => string }> = {
  REFUSAL_LETTER: {
    rule: LETTERS,
    outcome: "REFUSED",
    folder: "refusal",
    suffix: "refusal",
    notDecided: (name) => `${name} wasn't refused, so there's no refusal letter to add.`,
  },
  VISA_COPY: {
    rule: VISA_COPIES,
    outcome: "APPROVED",
    folder: "visa",
    suffix: "visa",
    notDecided: (name) => `${name} wasn't approved, so there's no visa copy to add.`,
  },
};

/**
 * The traveller, if they're on the case and decided as the letter needs, with the name the case shows them by. A visa
 * copy is a paper visa's: an approved e-visa's file is the e-visa itself (0025).
 */
async function letterTraveller(db: Db, enquiryId: string, travellerId: string, kind: LetterKind) {
  const visa = await db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: { submittedOnlineAt: true, travellers: { select: { id: true, position: true, isChild: true, name: true, outcome: true } } },
  });
  if (kind === "VISA_COPY" && visa.submittedOnlineAt) throw conflict("This is an e-visa: add its PDF as the e-visa.");
  const t = visa.travellers.find((x) => x.id === travellerId);
  if (!t) throw notFound("Traveller not found on this case.");
  const label = t.name ?? travellerLabel(t, countTravellers(visa.travellers).adults);
  if (t.outcome !== KINDS[kind].outcome) throw conflict(KINDS[kind].notDecided(label));
  return { ...t, label };
}

/**
 * Before the upload is read: the case must be one this user may change once decided, the traveller decided as the
 * letter needs, and the size limit is the decision files' (travellerFiles.ts). Refusing here means a wrong upload is
 * never held in memory.
 */
export async function letterLimit(caseNo: string, travellerId: string, kind: LetterKind, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, KINDS[kind].rule);
  await letterTraveller(prisma, enquiry.id, travellerId, kind);
  return decisionFileLimit((await getVisaSettings()).finalFile.maxMb);
}

/**
 * "VISA-2026-0001_Aarav-Mehta_refusal.pdf", "…_visa.pdf" ⚠️: the case number and the traveller's name, letters and
 * digits only.
 */
function letterFileName(caseNo: string, name: string, kind: LetterKind) {
  const safe = fileNamePart(name);
  const suffix = KINDS[kind].suffix;
  return safe ? `${caseNo}_${safe}_${suffix}.pdf` : `${caseNo}_${suffix}.pdf`;
}

/**
 * Saves a traveller's letter: one real PDF (a photo turned into one), its pages counted, in the private bucket under a
 * key no other upload shares. The bucket upload happens before the case lock, so a slow upload never holds the case.
 * Under the lock the checks are repeated; if they fail now, the row isn't saved and the object is removed again.
 */
export async function uploadLetter(caseNo: string, travellerId: string, kind: LetterKind, contentType: ScanType, bytes: Buffer, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, KINDS[kind].rule);
  const { pdf, pageCount, photo } = await travellerFilePdf(bytes, contentType, (await getVisaSettings()).finalFile.maxMb);
  const t = await letterTraveller(prisma, enquiry.id, travellerId, kind);
  const fileName = letterFileName(enquiry.caseNo, t.label, kind);
  const storageKey = `cases/${enquiry.id}/${KINDS[kind].folder}/${randomUUID()}.pdf`;
  await putObject(storageKey, pdf, "application/pdf");

  try {
    await prisma.$transaction(async (tx) => {
      await lockCase(tx, enquiry.id, actor, KINDS[kind].rule);
      const traveller = await letterTraveller(tx, enquiry.id, travellerId, kind);
      const previous = await tx.caseFile.findFirst({
        where: { travellerId, kind },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const file = await tx.caseFile.create({
        data: { enquiryId: enquiry.id, kind, travellerId, storageKey, fileName, sizeBytes: pdf.length, pageCount, uploadedById: actor.user.id },
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
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
  return getVisaCaseById(enquiry.id);
}
