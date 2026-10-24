import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { dayLabel, fromDbDate, toDbDate } from "../../lib/dates";
import { conflict, fieldError, notFound } from "../../lib/httpError";
import { checkWarnings, confirmedWarningsNote, type Warning } from "../../lib/warnings";
import type { Actor } from "../users/user";
import { DECIDED, DECIDING, loadCase, lockCase, visaStage } from "./caseLock";
import type { ChangeDecisionInput, RecordDecisionInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { travellerLabel } from "./visaCase";
import { deliverCase } from "./visaHandover.service";
import { queueDecisionMessage } from "./visaMessages";

// Visa Step 6, the decision (docs/decisions/0012-visa-decision.md). Once the file was submitted (at the embassy, or
// online for an e-visa), "Record the decision" saves every traveller's outcome at once (Decision 6), Approved or
// Refused, with nothing typed (amended 23 Oct 2026, change request 21). The case moves to Decision, due the next open
// office day at 11:00 ⚠️ (visa.passportsBackCheck) to check the passports are on their way back. A refusal changes no
// money. While the case is at Decision, or at Passport back until the handover, "Change" corrects one traveller's
// entry, or adds an approved one's sticker (or e-visa) number and the dates it's valid, each optional (Decisions 3 and
// 5); once the passports are received it checks the sticker again (amended 19 Oct 2026). The audit log keeps both. An
// e-visa where everyone is refused has nothing to send (docs/decisions/0025-evisa-after-decision.md part 5): with no
// passports held it closes, after a warning, whether recorded so or changed so; with passports held it's due for their
// handover.

/** What recording checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedAt: true,
      submittedOnlineAt: true,
      evisaSentAt: true,
      decidedAt: true,
      passportsReceivedAt: true,
      departOn: true,
      returnOn: true,
      bookletsCurrent: true,
      bookletsOld: true,
      handover: { select: { enquiryId: true } },
      travellers: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, isChild: true, name: true, outcome: true, visaNo: true, validFrom: true, validTo: true },
      },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * Whether these outcomes close the case when saved (0025, part 5): an e-visa where everyone is refused and we hold no
 * passports (none counted in at intake) has nothing left to send or hand back.
 */
function closesCase(g: Gathered, outcomes: { outcome: string | null }[]) {
  const held = !g.handover && (g.bookletsCurrent ?? 0) + (g.bookletsOld ?? 0) > 0;
  return !!g.submittedOnlineAt && !held && outcomes.every((o) => o.outcome === "REFUSED");
}

/** Warned first, as a closed case can't change: a wrong click mustn't close it. */
const CLOSES_CASE: Warning = {
  code: "CASE_CLOSES",
  message: "Everyone is refused and we hold no passports: saving closes the case, and a closed case can't be changed.",
};

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
 * One traveller's entry in Change (Decision 3, amended 23 Oct 2026): an approved one's number and dates are each
 * optional, but valid-to can't come before valid-from; a refused one has none. The message names the traveller.
 */
function checkOne(name: string, number: string, o: ChangeDecisionInput) {
  if (o.outcome === "APPROVED") {
    if (o.validFrom && o.validTo && o.validTo < o.validFrom) throw fieldError("decision", `${name}'s visa can't end before it starts.`);
  } else if (o.visaNo || o.validFrom || o.validTo) {
    throw fieldError("decision", `${name} was refused: leave the ${number} and dates empty.`);
  }
}

/**
 * Once the passports are received (0013 Decision 5), an approved traveller's change carries the sticker check again,
 * Matches or Doesn't match, so a corrected number or date can be marked as matching (amended 19 Oct 2026). Before then,
 * and for a refused traveller, there's no sticker to check. An e-visa is checked on its row, beside its PDF (0025).
 */
function checkSticker(g: Gathered, name: string, o: ChangeDecisionInput) {
  const checking = !!g.passportsReceivedAt && o.outcome === "APPROVED";
  if (checking && !o.stickerCheck) throw fieldError("decision", `Check ${name}'s sticker against the passport: Matches or Doesn't match.`);
  if (!checking && o.stickerCheck) {
    const why = g.passportsReceivedAt
      ? `${name} was refused: there's no sticker to check.`
      : g.submittedOnlineAt
        ? "An e-visa is checked on its row, beside its PDF."
        : "The sticker is checked once the passports are received.";
    throw fieldError("decision", why);
  }
}

/** Every traveller of the case exactly once. Messages name the traveller, as the dialog lists them. */
function checkOutcomes(g: Gathered, outcomes: RecordDecisionInput["outcomes"]) {
  const { who } = wording(g);
  const byId = new Map(g.travellers.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const o of outcomes) {
    const t = byId.get(o.travellerId);
    if (!t) throw fieldError("outcomes", "Someone on this list isn't on the case. Reload and try again.");
    if (seen.has(t.id)) throw fieldError("outcomes", `${who(t)} is on the list twice.`);
    seen.add(t.id);
  }
  const missing = g.travellers.find((t) => !seen.has(t.id));
  if (missing) throw fieldError("outcomes", `Record ${who(missing)}'s decision too.`);
  return who;
}

/**
 * What a change may have wrong but can be right (soft warnings, decided 19 Oct 2026; lib/warnings.ts): an approved
 * visa's number already on another case.
 */
async function decisionWarnings(db: Db, enquiryId: string, g: Gathered, outcomes: { outcome: string; visaNo?: string | null | undefined }[]): Promise<Warning[]> {
  const numbers = outcomes.flatMap((o) => (o.outcome === "APPROVED" && o.visaNo ? [o.visaNo] : []));
  if (numbers.length === 0) return [];
  const { number } = wording(g);
  const label = number.charAt(0).toUpperCase() + number.slice(1);
  const elsewhere = await db.visaCaseTraveller.findMany({
    where: { visaNo: { in: numbers }, caseId: { not: enquiryId } },
    select: { visaNo: true, name: true, visaCase: { select: { enquiry: { select: { caseNo: true } } } } },
    orderBy: [{ visaNo: "asc" }, { caseId: "asc" }],
    take: 10,
  });
  return elsewhere.map((t) => ({
    code: "VISA_NO_ELSEWHERE",
    message: `${label} ${t.visaNo} is already on ${t.visaCase.enquiry.caseNo}${t.name ? ` (${t.name})` : ""}.`,
  }));
}

/**
 * Visa dates that don't cover the trip (a soft warning in Change, decided 19 Oct 2026): valid from after the departure
 * day, or valid to before the return. An embassy sometimes grants less, so it can be right. Each date is checked when
 * it's there: either can be added alone (amended 23 Oct 2026).
 */
function tripWarnings(
  g: Gathered,
  outcomes: { travellerId: string; outcome: string; validFrom?: string | null | undefined; validTo?: string | null | undefined }[],
): Warning[] {
  const { who } = wording(g);
  const depart = g.departOn ? fromDbDate(g.departOn) : null;
  const back = g.returnOn ? fromDbDate(g.returnOn) : null;
  return outcomes.flatMap((o) => {
    const t = g.travellers.find((x) => x.id === o.travellerId);
    if (!t || o.outcome !== "APPROVED") return [];
    const found: Warning[] = [];
    if (depart && o.validFrom && o.validFrom > depart) {
      found.push({ code: "VISA_STARTS_AFTER_DEPARTURE", message: `${who(t)}'s visa starts ${dayLabel(o.validFrom)}, after the trip begins (${dayLabel(depart)}).` });
    }
    if (back && o.validTo && o.validTo < back) {
      found.push({ code: "VISA_ENDS_BEFORE_RETURN", message: `${who(t)}'s visa ends ${dayLabel(o.validTo)}, before the trip ends (${dayLabel(back)}).` });
    }
    return found;
  });
}

/**
 * "Record the decision" (Decision 6), by whoever can act on the case, at At vendor once the file was submitted. In one
 * transaction under the case lock: each traveller's outcome (nothing typed, amended 23 Oct 2026), who recorded it and
 * when, the move to Decision with its due time, and the audit (visa.decision.record). An e-visa where everyone is
 * refused is due for the handover of the passports we hold, or, with none held, moves on to Delivered and closes, after
 * a warning (0025, part 5).
 */
export async function recordDecision(caseNo: string, input: RecordDecisionInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DECIDING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  assertSubmitted(pre);
  checkOutcomes(pre, input.outcomes);
  const warnings = (g: Gathered) => (closesCase(g, input.outcomes) ? [CLOSES_CASE] : []);
  checkWarnings(warnings(pre), input.confirmWarnings);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, DECIDING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertSubmitted(g);
    const who = checkOutcomes(g, input.outcomes);
    const confirmed = checkWarnings(warnings(g), input.confirmWarnings);

    const settings = await getVisaSettings(tx);
    const evisa = !!g.submittedOnlineAt;
    const closing = closesCase(g, input.outcomes);
    // An e-visa where everyone is refused has nothing to send: the passports we hold go back next (0025, part 5).
    const everyoneRefused = input.outcomes.every((o) => o.outcome === "REFUSED");
    const dueAt = closing ? null : await dueOnOfficeDay(evisa && everyoneRefused ? settings.handoverCheck : settings.passportsBackCheck, tx);
    const decision = await visaStage(tx, locked.departmentId, "DECISION");
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: decision.id, dueAt } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { decidedAt: new Date(), decidedById: actor.user.id } });
    // An undecided traveller has no number or dates (the database's CHECK): they're added later with Change.
    for (const o of input.outcomes) {
      await tx.visaCaseTraveller.update({ where: { id: o.travellerId }, data: { outcome: o.outcome } });
    }
    // Nothing to send or hand back: on to Delivered, closed, as a sent e-visa with no passports held (part 3).
    const closed = closing ? (await deliverCase(tx, { ...locked, stage: decision }, actor, "everyone was refused", { evisa: true })).closes : false;
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
          stage: closed ? "DELIVERED" : "DECISION",
          ...(closed ? { status: "CLOSED" } : {}),
          dueAt,
          travellers: g.travellers.map((t) => ({ name: who(t), outcome: outcomes.get(t.id)!.outcome })),
          ...confirmedWarningsNote(confirmed),
        },
        ip: actor.ip,
      },
      tx,
    );
    // Messages 10–12 (docs/whatsapp-visa-messages.md); an e-visa's are 20 and 21, and none when everyone is approved.
    const decided = g.travellers.map((t) => ({ name: who(t), outcome: outcomes.get(t.id)!.outcome }));
    await queueDecisionMessage(tx, enquiry.id, decided, settings.passportsArrive.workingDays, { evisa });
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * "Change" on one traveller's row (Decision 6), by whoever can act on the case, while it's at Decision or at Passport
 * back until the handover (amended 19 Oct 2026): the outcome, or just an approved one's number or dates, each optional
 * and added here after recording (amended 23 Oct 2026); a number already elsewhere, or dates that don't cover the trip,
 * warn first when they change (lib/warnings.ts). Once the passports are received, an approved traveller's change carries
 * the sticker check (checkSticker); a refused one's is cleared. An e-visa's check (0025) stands while the entry stays as
 * it was, and is cleared when it changes: the PDF must be looked at against it again. In one transaction under the case
 * lock: the traveller's entry, the case's updatedAt and the audit (visa.decision.change, with the old and new values).
 * It sends the case's updatedAt from when the dialog opened,
 * so a save after someone else's change is refused (409 STALE) instead of undoing it (amended 19 Oct 2026). The case's
 * step, due time and "recorded by" stay, except that an e-visa the change leaves with everyone refused, and no passports
 * held, moves on to Delivered and closes, after a warning (0025, part 5). A save that changes nothing writes nothing.
 */
export async function changeDecision(caseNo: string, travellerId: string, input: ChangeDecisionInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DECIDED);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const check = (g: Gathered) => {
    // A recalled file reaches Passport back with no decision: there's nothing to correct.
    if (!g.decidedAt) throw conflict("This file was taken back before a decision: there's none to change.");
    // An e-visa sent to the client stays as it went (docs/decisions/0025-evisa-after-decision.md, part 3).
    if (g.evisaSentAt) throw conflict("The e-visa has gone to the client: the decision can't change now.");
    const t = g.travellers.find((x) => x.id === travellerId);
    if (!t) throw notFound("Traveller not found on this case.");
    const { who, number } = wording(g);
    checkOne(who(t), number, input);
    // Each visa has its own number (decided 19 Oct 2026).
    const twin = input.outcome === "APPROVED" && input.visaNo ? g.travellers.find((x) => x.id !== travellerId && x.visaNo === input.visaNo) : undefined;
    if (twin) throw fieldError("decision", `${who(twin)} already has this ${number}: each visa has its own.`);
    checkSticker(g, who(t), input);
    return who(t);
  };
  /** An e-visa this change leaves with everyone refused, and no passports held, closes (0025, part 5). */
  const closing = (g: Gathered) =>
    g.travellers.some((x) => x.outcome !== "REFUSED") && closesCase(g, g.travellers.map((x) => (x.id === travellerId ? input : x)));
  /** The warnings for this change, for what it changes: what's unchanged was confirmed when it was saved. */
  const warningsFor = async (db: Db, g: Gathered) => {
    const before = g.travellers.find((x) => x.id === travellerId);
    const numberChanged = (input.visaNo ?? null) !== (before?.visaNo ?? null);
    const datesChanged =
      (input.validFrom ?? null) !== (before?.validFrom ? fromDbDate(before.validFrom) : null) ||
      (input.validTo ?? null) !== (before?.validTo ? fromDbDate(before.validTo) : null);
    return [
      ...(await decisionWarnings(db, enquiry.id, g, numberChanged ? [input] : [])),
      ...(datesChanged ? tripWarnings(g, [{ travellerId, ...input }]) : []),
      ...(closing(g) ? [CLOSES_CASE] : []),
    ];
  };
  const pre = await gather(prisma, enquiry.id);
  check(pre);
  checkWarnings(await warningsFor(prisma, pre), input.confirmWarnings);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, DECIDED);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    const name = check(g);
    const confirmed = checkWarnings(await warningsFor(tx, g), input.confirmWarnings);
    const row = await tx.visaCaseTraveller.findUniqueOrThrow({
      where: { id: travellerId },
      select: { outcome: true, visaNo: true, validFrom: true, validTo: true, stickerCheck: true },
    });
    const was = {
      outcome: row.outcome,
      visaNo: row.visaNo,
      validFrom: row.validFrom && fromDbDate(row.validFrom),
      validTo: row.validTo && fromDbDate(row.validTo),
      stickerCheck: row.stickerCheck,
    };
    const entry = {
      outcome: input.outcome,
      visaNo: input.visaNo ?? null,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
    };
    const same = was.outcome === entry.outcome && was.visaNo === entry.visaNo && was.validFrom === entry.validFrom && was.validTo === entry.validTo;
    const now = {
      ...entry,
      // Checked again once received; an e-visa's stands while its entry does (0025); a refused traveller has none (the
      // database's CHECK).
      stickerCheck:
        g.passportsReceivedAt && input.outcome === "APPROVED" ? (input.stickerCheck ?? null) : g.submittedOnlineAt && same ? row.stickerCheck : null,
    };
    if (same && was.stickerCheck === now.stickerCheck) return;

    await tx.visaCaseTraveller.update({
      where: { id: travellerId },
      data: {
        outcome: now.outcome,
        visaNo: now.visaNo,
        validFrom: now.validFrom ? toDbDate(now.validFrom) : null,
        validTo: now.validTo ? toDbDate(now.validTo) : null,
        stickerCheck: now.stickerCheck,
      },
    });
    // The case moves on too, so a page or dialog opened before this change can't save over it.
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { updatedAt: new Date() } });
    // Nothing left to send or hand back: on to Delivered, closed, as when recorded so (0025, part 5).
    const closed = closing(g) ? (await deliverCase(tx, locked, actor, "everyone was refused", { evisa: true })).closes : false;
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.decision.change",
        entityType: "VisaCaseTraveller",
        entityId: travellerId,
        clientId: enquiry.clientId,
        before: { name, ...was },
        after: { name, ...now, ...(closed ? { caseClosed: { stage: "DELIVERED", status: "CLOSED" } } : {}), ...confirmedWarningsNote(confirmed) },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
