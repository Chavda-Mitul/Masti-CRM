import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fieldError, notFound } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { loadCase, lockCase, PREPARING } from "./caseLock";
import type { CheckCaseDocumentInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";

// Visa Step 3, file preparation (docs/decisions/0007-visa-file-prep.md): the processor's check of each paper. Every
// write locks the case first (caseLock.ts), so "File ready" and a change here take turns.

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
