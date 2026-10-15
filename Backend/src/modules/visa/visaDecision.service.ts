import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { toDbDate } from "../../lib/dates";
import { conflict, fieldError } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { DECIDING, loadCase, lockCase, visaStage } from "./caseLock";
import type { RecordDecisionInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { travellerLabel } from "./visaCase";

// Visa Step 6, the decision (docs/decisions/0012-visa-decision.md). Once the file was submitted (at the embassy, or
// online for an e-visa), "Record the decision" saves every traveller's outcome at once (Decision 6): Approved, with the
// sticker (or e-visa) number and the dates it's valid (Decisions 3 and 5), or Refused. The case moves to Decision, due
// the next open office day at 11:00 ⚠️ (visa.passportsBackCheck) to check the passports are on their way back. A refusal
// changes no money.

/** What recording checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedAt: true,
      submittedOnlineAt: true,
      travellers: { orderBy: { position: "asc" }, select: { id: true, position: true, isChild: true, name: true } },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** The file went in: at the embassy (0011 Decision 3), or online for an e-visa. */
function assertSubmitted(g: Gathered) {
  if (!g.submittedAt && !g.submittedOnlineAt) throw conflict("Mark it submitted at the embassy first.");
}

/**
 * Every traveller of the case exactly once, an approved one with the number and both dates (valid-to on or after
 * valid-from), a refused one with none. Messages name the traveller, as the dialog lists them.
 */
function checkOutcomes(g: Gathered, outcomes: RecordDecisionInput["outcomes"]) {
  const adults = g.travellers.filter((t) => !t.isChild).length;
  const who = (t: Gathered["travellers"][number]) => t.name ?? travellerLabel(t, adults);
  const number = g.submittedOnlineAt ? "e-visa number" : "sticker number";
  const byId = new Map(g.travellers.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const o of outcomes) {
    const t = byId.get(o.travellerId);
    if (!t) throw fieldError("outcomes", "Someone on this list isn't on the case. Reload and try again.");
    if (seen.has(t.id)) throw fieldError("outcomes", `${who(t)} is on the list twice.`);
    seen.add(t.id);
    if (o.outcome === "APPROVED") {
      if (!o.visaNo) throw fieldError("outcomes", `Enter ${who(t)}'s ${number}.`);
      if (!o.validFrom || !o.validTo) throw fieldError("outcomes", `Enter the dates ${who(t)}'s visa is valid.`);
      if (o.validTo < o.validFrom) throw fieldError("outcomes", `${who(t)}'s visa can't end before it starts.`);
    } else if (o.visaNo || o.validFrom || o.validTo) {
      throw fieldError("outcomes", `${who(t)} was refused: leave the ${number} and dates empty.`);
    }
  }
  const missing = g.travellers.find((t) => !seen.has(t.id));
  if (missing) throw fieldError("outcomes", `Record ${who(missing)}'s decision too.`);
  return who;
}

/**
 * "Record the decision" (Decision 6), by whoever can act on the case, at At vendor once the file was submitted. In one
 * transaction under the case lock: each traveller's outcome, who recorded it and when, the move to Decision with its due
 * time, and the audit (visa.decision.record).
 */
export async function recordDecision(caseNo: string, input: RecordDecisionInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DECIDING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  assertSubmitted(pre);
  checkOutcomes(pre, input.outcomes);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, DECIDING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertSubmitted(g);
    const who = checkOutcomes(g, input.outcomes);

    const dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).passportsBackCheck, tx);
    const decision = await visaStage(tx, locked.departmentId, "DECISION");
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: decision.id, dueAt } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { decidedAt: new Date(), decidedById: actor.user.id } });
    for (const o of input.outcomes) {
      await tx.visaCaseTraveller.update({
        where: { id: o.travellerId },
        data: {
          outcome: o.outcome,
          visaNo: o.visaNo ?? null,
          validFrom: o.validFrom ? toDbDate(o.validFrom) : null,
          validTo: o.validTo ? toDbDate(o.validTo) : null,
        },
      });
    }
    const outcomes = new Map(input.outcomes.map((o) => [o.travellerId, o]));
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.decision.record",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: "AT_VENDOR", dueAt: locked.dueAt },
        after: {
          stage: "DECISION",
          dueAt,
          travellers: g.travellers.map((t) => {
            const o = outcomes.get(t.id)!;
            return { name: who(t), outcome: o.outcome, visaNo: o.visaNo ?? null, validFrom: o.validFrom ?? null, validTo: o.validTo ?? null };
          }),
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
