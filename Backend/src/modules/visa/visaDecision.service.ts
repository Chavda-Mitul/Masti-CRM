import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { fromDbDate, toDbDate } from "../../lib/dates";
import { conflict, fieldError, notFound } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { DECIDED, DECIDING, loadCase, lockCase, visaStage } from "./caseLock";
import type { ChangeDecisionInput, RecordDecisionInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { travellerLabel } from "./visaCase";

// Visa Step 6, the decision (docs/decisions/0012-visa-decision.md). Once the file was submitted (at the embassy, or
// online for an e-visa), "Record the decision" saves every traveller's outcome at once (Decision 6): Approved, with the
// sticker (or e-visa) number and the dates it's valid (Decisions 3 and 5), or Refused. The case moves to Decision, due
// the next open office day at 11:00 ⚠️ (visa.passportsBackCheck) to check the passports are on their way back. A refusal
// changes no money. While the case is at Decision, "Change" corrects one traveller's entry; the audit log keeps both.

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

/** How the case names a traveller (the passport name, else "Adult 1"), and what its visas' numbers are called. */
function wording(g: Gathered) {
  const adults = g.travellers.filter((t) => !t.isChild).length;
  return {
    who: (t: Gathered["travellers"][number]) => t.name ?? travellerLabel(t, adults),
    number: g.submittedOnlineAt ? "e-visa number" : "sticker number",
  };
}

/**
 * One traveller's outcome (Decision 3): an approved one with the number and both dates (valid-to on or after
 * valid-from), a refused one with none. The message names the traveller and goes under `field`.
 */
function checkOne(field: string, name: string, number: string, o: Omit<ChangeDecisionInput, "updatedAt">) {
  if (o.outcome === "APPROVED") {
    if (!o.visaNo) throw fieldError(field, `Enter ${name}'s ${number}.`);
    if (!o.validFrom || !o.validTo) throw fieldError(field, `Enter the dates ${name}'s visa is valid.`);
    if (o.validTo < o.validFrom) throw fieldError(field, `${name}'s visa can't end before it starts.`);
  } else if (o.visaNo || o.validFrom || o.validTo) {
    throw fieldError(field, `${name} was refused: leave the ${number} and dates empty.`);
  }
}

/**
 * Every traveller of the case exactly once, each checked by checkOne. Messages name the traveller, as the dialog lists
 * them.
 */
function checkOutcomes(g: Gathered, outcomes: RecordDecisionInput["outcomes"]) {
  const { who, number } = wording(g);
  const byId = new Map(g.travellers.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const o of outcomes) {
    const t = byId.get(o.travellerId);
    if (!t) throw fieldError("outcomes", "Someone on this list isn't on the case. Reload and try again.");
    if (seen.has(t.id)) throw fieldError("outcomes", `${who(t)} is on the list twice.`);
    seen.add(t.id);
    checkOne("outcomes", who(t), number, o);
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

/**
 * "Change" on one traveller's row (Decision 6), by whoever can act on the case, while it's at Decision: the outcome, or
 * just the number or dates. In one transaction under the case lock: the traveller's entry, the case's updatedAt and the
 * audit (visa.decision.change, with the old and new values). It sends the case's updatedAt from when the dialog opened,
 * so a save after someone else's change is refused (409 STALE) instead of undoing it (amended 19 Oct 2026). The case's
 * step, due time and "recorded by" stay. A save that changes nothing writes nothing.
 */
export async function changeDecision(caseNo: string, travellerId: string, input: ChangeDecisionInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DECIDED);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const check = (g: Gathered) => {
    const t = g.travellers.find((x) => x.id === travellerId);
    if (!t) throw notFound("Traveller not found on this case.");
    const { who, number } = wording(g);
    checkOne("decision", who(t), number, input);
    return who(t);
  };
  check(await gather(prisma, enquiry.id));

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, DECIDED);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const name = check(await gather(tx, enquiry.id));
    const row = await tx.visaCaseTraveller.findUniqueOrThrow({
      where: { id: travellerId },
      select: { outcome: true, visaNo: true, validFrom: true, validTo: true },
    });
    const was = {
      outcome: row.outcome,
      visaNo: row.visaNo,
      validFrom: row.validFrom && fromDbDate(row.validFrom),
      validTo: row.validTo && fromDbDate(row.validTo),
    };
    const now = { outcome: input.outcome, visaNo: input.visaNo ?? null, validFrom: input.validFrom ?? null, validTo: input.validTo ?? null };
    if (was.outcome === now.outcome && was.visaNo === now.visaNo && was.validFrom === now.validFrom && was.validTo === now.validTo) return;

    await tx.visaCaseTraveller.update({
      where: { id: travellerId },
      data: {
        outcome: now.outcome,
        visaNo: now.visaNo,
        validFrom: now.validFrom ? toDbDate(now.validFrom) : null,
        validTo: now.validTo ? toDbDate(now.validTo) : null,
      },
    });
    // The case moves on too, so a page or dialog opened before this change can't save over it.
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { updatedAt: new Date() } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.decision.change",
        entityType: "VisaCaseTraveller",
        entityId: travellerId,
        clientId: enquiry.clientId,
        before: { name, ...was },
        after: { name, ...now },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
