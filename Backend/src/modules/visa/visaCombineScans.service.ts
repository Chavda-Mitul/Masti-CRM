import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { conflict, HttpError } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { deleteObject, getObject, putObject } from "../../lib/storage";
import { currentScansOf } from "../clients/clientDocuments.service";
import type { Actor } from "../users/user";
import { COMBINING, loadCase, lockCase } from "./caseLock";
import { missingScansText, scansForFile, scansPdf } from "./scansPdf";
import { getVisaCaseById } from "./visa.service";
import { fileSafeFamilyName, scanTravellersOf } from "./visaCase";

// The case's scans combined into its saved file (docs/decisions/0008-visa-docket-dispatch.md Amendment 1, change
// request 20). "Mark documents complete" queues a job that does it (visaCombineScans.worker.ts), so File preparation
// starts with the saved file; "File ready" queues it again in case it couldn't. "Combine again" on the Saved file card
// (File preparation) and the Docket or Submit online card (Docket & dispatch) tries again, for whoever can act on the
// case. Every paper that came in needs a scan, the person's newest on file (scansPdf.ts); if any is missing, nothing is
// made. The PDF becomes the newest saved file; an upload already there stays as an earlier copy. It's made once: under
// the case's lock a second look sees a copy made meanwhile, so a job and a press at the same moment save one.

/** The job "Mark documents complete" and "File ready" queue: the case, and who pressed it (the file is saved as theirs). */
export interface CombineScansJob {
  enquiryId: string;
  userId: string;
}

const ALREADY_COMBINED = "The scans are already combined into the saved file.";

/** "VISA-2026-0001_Mehta_scans.pdf" ⚠️: named like the saved file it joins (finalFileName), ending "scans". */
function scansFileName(caseNo: string, clientName: string) {
  const safe = fileSafeFamilyName(clientName);
  return safe ? `${caseNo}_${safe}_scans.pdf` : `${caseNo}_scans.pdf`;
}

/** Whether a saved file was made from the scans already. */
async function combinedBefore(db: Db, enquiryId: string) {
  return (await db.caseFile.count({ where: { enquiryId, kind: "FINAL_FILE", scanCount: { not: null } } })) > 0;
}

/** The case's travellers and papers, and what the file is named after. */
function papersOf(enquiryId: string) {
  return prisma.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      caseNo: true,
      clientId: true,
      client: { select: { name: true } },
      visa: {
        select: {
          travellers: {
            orderBy: { position: "asc" },
            select: {
              position: true,
              isChild: true,
              name: true,
              memberId: true,
              member: { select: { name: true } },
              documents: {
                orderBy: { sortOrder: "asc" },
                select: { name: true, documentId: true, status: true, receivedAs: true, clientDocumentId: true },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Makes the PDF and saves it as the newest saved file, by `userId`. Refuses with an HttpError: already combined, scans
 * missing, no paper came in, or a scan that can't be opened. `lock` takes the case's lock in the saving transaction and
 * checks again that the case may change. The bucket upload comes first, so building and uploading never hold the lock;
 * a refusal there removes the object again.
 */
async function combine(enquiryId: string, by: { userId: string; ip: string | null }, auto: boolean, lock: (tx: Db) => Promise<unknown>) {
  if (await combinedBefore(prisma, enquiryId)) throw conflict(ALREADY_COMBINED);
  const c = await papersOf(enquiryId);
  const travellers = scanTravellersOf(c.visa!.travellers);
  const current = await currentScansOf(travellers.flatMap((t) => (t.memberId ? [t.memberId] : [])));
  const { found, missing } = scansForFile(travellers, current);
  if (missing.length > 0) throw new HttpError(409, `Not combined: ${missingScansText(missing)}.`, { code: "SCANS_MISSING", missing });
  if (found.length === 0) throw conflict("No paper came in, so there are no scans to combine.");

  const stored = new Map(
    (
      await prisma.clientDocument.findMany({
        where: { id: { in: found.map((f) => f.scanId) } },
        select: { id: true, storageKey: true, contentType: true },
      })
    ).map((s) => [s.id, s]),
  );
  const { bytes, pageCount } = await scansPdf(
    found.map((f) => {
      const scan = stored.get(f.scanId)!;
      return { what: `${f.traveller}'s ${f.paper}`, contentType: scan.contentType, load: () => getObject(scan.storageKey) };
    }),
    `${c.caseNo} scans`,
  );

  const fileName = scansFileName(c.caseNo, c.client.name);
  const storageKey = `cases/${enquiryId}/final/${randomUUID()}.pdf`;
  await putObject(storageKey, bytes, "application/pdf");
  try {
    await prisma.$transaction(async (tx) => {
      await lock(tx);
      if (await combinedBefore(tx, enquiryId)) throw conflict(ALREADY_COMBINED);
      const previous = await tx.caseFile.findFirst({
        where: { enquiryId, kind: "FINAL_FILE" },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const file = await tx.caseFile.create({
        data: { enquiryId, kind: "FINAL_FILE", storageKey, fileName, sizeBytes: bytes.length, pageCount, scanCount: found.length, uploadedById: by.userId },
      });
      await audit(
        {
          actorId: by.userId,
          action: "visa.file.combine",
          entityType: "CaseFile",
          entityId: file.id,
          clientId: c.clientId,
          after: {
            kind: file.kind,
            fileName,
            sizeBytes: file.sizeBytes,
            pageCount,
            scanCount: found.length,
            scans: found.map((f) => f.scanId),
            storageKey,
            replaces: previous?.id ?? null,
            auto,
          },
          ip: by.ip,
        },
        tx,
      );
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved combined file."));
    throw err;
  }
}

/**
 * For the job: the case is still at file preparation or waiting for dispatch, and open (not postponed, cancelled or
 * closed). Who may isn't asked again: the job acts for whoever pressed the button that queued it.
 */
async function assertWaiting(db: Db, enquiryId: string) {
  const enquiry = await db.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, select: { status: true, stage: { select: { code: true } } } });
  if (enquiry.status !== "OPEN" || !COMBINING.stages.includes(enquiry.stage.code)) throw conflict(COMBINING.wrongStage);
}

/**
 * The job "Mark documents complete" or "File ready" queued. A refusal (scans missing, already combined, a scan that
 * can't be opened, the case moved on) is logged and the job ends: trying again wouldn't change it, and the card shows
 * what's missing. Any other error (the bucket, the database) is thrown, so pg-boss tries again.
 */
export async function runCombineScansJob({ enquiryId, userId }: CombineScansJob) {
  try {
    await assertWaiting(prisma, enquiryId);
    await combine(enquiryId, { userId, ip: null }, true, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ${enquiryId} FOR UPDATE`;
      await assertWaiting(tx, enquiryId);
    });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    logger.info({ enquiryId, reason: err.message }, "The case's scans weren't combined.");
  }
}

/**
 * "Combine again" (0008 Amendment 1): whoever can act on the case, during file preparation or while it waits for
 * dispatch. Returns the case.
 */
export async function combineScansNow(caseNo: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, COMBINING);
  await combine(enquiry.id, { userId: actor.user.id, ip: actor.ip }, false, (tx) => lockCase(tx, enquiry.id, actor, COMBINING));
  return getVisaCaseById(enquiry.id);
}
