import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { addDays, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError } from "../../lib/httpError";
import { blockedDays } from "../holidays/blockedDays";
import type { Actor } from "../users/user";
import { IN_TRANSIT, loadCase, lockCase, RECEIVING, RETURNING, visaStage } from "./caseLock";
import { bookletsSent, missingBooklets } from "./shortfall";
import {
  MAX_COLLECTION_DAYS_AHEAD,
  type ClearShortfallInput,
  type ReceivePassportsInput,
  type ReceiveRestInput,
  type SendPassportsBackInput,
} from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { travellerLabel } from "./visaCase";

// Visa Step 7, passport back (docs/decisions/0013-visa-passport-back.md). "Passports on the way back" records the day
// the vendor collected the passports and the day they're expected at our office (Decision 3), from Decision, or at
// Passport back for a recalled file. The passports are then in transit until they're marked received, and the case is
// due on the expected day at 11:00 ⚠️ (visa.arrivalCheck). While they're in transit, "Change" corrects either day
// (component 2). "Mark received" puts them in our stock, with the booklets counted and the stickers checked
// (Decision 5, component 3). An e-visa's passports never left the office, so it waits at Decision (Decision 4). A short
// return holds the handover until "Received the rest" adds the late booklets, or "Clear the shortfall" records, with a
// reason, that they won't come (Decision 5, amended 17 Oct 2026).

/** What sending the passports back, or changing their dates, checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedOnlineAt: true,
      passportsCollectedOn: true,
      passportsExpectedOn: true,
      passportsInTransitAt: true,
      passportsReceivedAt: true,
      docket: { select: { dispatchedAt: true } },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * A paper file not yet on its way back. The step rule already keeps it to Decision (decided) or Passport back (which
 * only a recall reaches before this).
 */
function assertCanSend(g: Gathered) {
  if (g.submittedOnlineAt) throw conflict("An e-visa's passports never left the office.");
  if (g.passportsInTransitAt) throw conflict("The passports are already on their way back.");
}

/** On their way back and not yet received. */
function assertInTransit(g: Gathered) {
  if (!g.passportsInTransitAt) throw conflict("Mark the passports on the way back first.");
  if (g.passportsReceivedAt) throw conflict("The passports are already in our stock.");
}

/**
 * The vendor collected them today or earlier (on a change, no later than the day they were recorded on the way back,
 * as the CHECK VisaCase_in_transit_dates keeps), not before the file was dispatched. They're expected today or later
 * (so never before they were collected), within a year, on a day our office is open (Sundays and office holidays are
 * refused, by name).
 */
async function checkDates(db: Db, input: SendPassportsBackInput, g: Gathered) {
  const today = istToday();
  const dispatchedOn = g.docket?.dispatchedAt ? istToday(g.docket.dispatchedAt) : null;
  const recordedOn = g.passportsInTransitAt ? istToday(g.passportsInTransitAt) : null;
  if (recordedOn && input.collectedOn > recordedOn) {
    throw fieldError("collectedOn", "Pick a day on or before the day they were recorded on the way back.");
  }
  if (input.collectedOn > today) throw fieldError("collectedOn", "Pick today or an earlier day.");
  if (dispatchedOn && input.collectedOn < dispatchedOn) throw fieldError("collectedOn", "Pick a day on or after the file was dispatched.");
  if (input.expectedOn < today) throw fieldError("expectedOn", "Pick today or a later day.");
  if (input.expectedOn > addDays(today, MAX_COLLECTION_DAYS_AHEAD)) throw fieldError("expectedOn", "Pick a day within the next year.");
  const [closed] = await blockedDays(input.expectedOn, input.expectedOn, { office: true }, db);
  if (closed) {
    const why = closed.holidays.map((h) => h.name).join(", ");
    throw fieldError("expectedOn", `${why}: our office is closed that day. Pick another.`);
  }
}

/**
 * "Passports on the way back" (Decision 3), by whoever can act on the case, while it's open or cancelled (0006 amendment
 * 15: a cancelled case's passports still come back). In one transaction under
 * the case lock: the two days, who recorded them and when, the move to Passport back with its due time, and the audit
 * (visa.passports.inTransit).
 */
export async function sendPassportsBack(caseNo: string, input: SendPassportsBackInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, RETURNING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  assertCanSend(pre);
  await checkDates(prisma, input, pre);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, RETURNING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertCanSend(g);
    await checkDates(tx, input, g);

    const dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).arrivalCheck, tx, input.expectedOn);
    const passportBack = await visaStage(tx, locked.departmentId, "PASSPORT_BACK");
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: passportBack.id, dueAt } });
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: {
        passportsCollectedOn: toDbDate(input.collectedOn),
        passportsExpectedOn: toDbDate(input.expectedOn),
        passportsInTransitAt: new Date(),
        passportsInTransitById: actor.user.id,
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.passports.inTransit",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: locked.stage.code, dueAt: locked.dueAt },
        after: { stage: "PASSPORT_BACK", dueAt, collectedOn: input.collectedOn, expectedOn: input.expectedOn },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * "Change" on the Passports coming back card (component 2): either day, checked as when first saved, while the case is
 * at Passport back and the passports are in transit. In one transaction under the case lock: the two days, the due time
 * moved with the expected day, and the audit (visa.passports.update, with the old and new values). Who recorded them on
 * the way back, and when, stay. A save that changes nothing writes nothing.
 */
export async function changePassportsBack(caseNo: string, input: SendPassportsBackInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, IN_TRANSIT);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  assertInTransit(pre);
  await checkDates(prisma, input, pre);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, IN_TRANSIT);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertInTransit(g);
    await checkDates(tx, input, g);

    const was = { collectedOn: fromDbDate(g.passportsCollectedOn!), expectedOn: fromDbDate(g.passportsExpectedOn!) };
    if (was.collectedOn === input.collectedOn && was.expectedOn === input.expectedOn) return;

    const dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).arrivalCheck, tx, input.expectedOn);
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: { passportsCollectedOn: toDbDate(input.collectedOn), passportsExpectedOn: toDbDate(input.expectedOn) },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.passports.update",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { ...was, dueAt: locked.dueAt },
        after: { collectedOn: input.collectedOn, expectedOn: input.expectedOn, dueAt },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/** What receiving the passports checks, read again under the lock. */
async function gatherReceipt(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      passportsInTransitAt: true,
      passportsReceivedAt: true,
      bookletsCurrent: true,
      bookletsOld: true,
      travellers: { orderBy: { position: "asc" }, select: { id: true, position: true, isChild: true, name: true, outcome: true } },
    },
  });
}

type Receipt = Awaited<ReturnType<typeof gatherReceipt>>;

/** On their way back, and not yet received: a receipt is never changed once saved (decided 17 Oct 2026). */
function assertCanReceive(r: Receipt) {
  if (!r.passportsInTransitAt) throw conflict("Mark the passports on the way back first.");
  if (r.passportsReceivedAt) throw conflict("The passports are already in our stock.");
}

/**
 * Every approved traveller's sticker checked once, and nobody else's: a refused traveller, and everyone on a recalled
 * file, has no sticker (Decision 5). Messages name the traveller, as the dialog lists them.
 */
function checkStickers(r: Receipt, stickers: ReceivePassportsInput["stickers"]) {
  const adults = r.travellers.filter((t) => !t.isChild).length;
  const who = (t: Receipt["travellers"][number]) => t.name ?? travellerLabel(t, adults);
  const byId = new Map(r.travellers.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const s of stickers) {
    const t = byId.get(s.travellerId);
    if (!t) throw fieldError("stickers", "Someone on this list isn't on the case. Reload and try again.");
    if (seen.has(t.id)) throw fieldError("stickers", `${who(t)} is on the list twice.`);
    if (t.outcome === "REFUSED") throw fieldError("stickers", `${who(t)} was refused: there's no sticker to check.`);
    if (t.outcome !== "APPROVED") throw fieldError("stickers", `${who(t)} has no visa: there's no sticker to check.`);
    seen.add(t.id);
  }
  const missing = r.travellers.find((t) => t.outcome === "APPROVED" && !seen.has(t.id));
  if (missing) throw fieldError("stickers", `Check ${who(missing)}'s sticker.`);
  return who;
}

/**
 * "Mark received" (Decision 5), by whoever can act on the case, whatever its status: the packet is here, so it's
 * counted in (decided 17 Oct 2026). A count that doesn't match what went to the vendor, or a sticker that doesn't
 * match, is recorded and shown, not refused; a short count then holds the handover until it's settled (amended 17 Oct
 * 2026). In one transaction under the case lock: who received them and when, the booklets, each approved traveller's
 * sticker check, the due time to arrange the handover (an open or cancelled case: visa.handoverCheck ⚠️; a cancelled one
 * stays on its owner's list until handed back, 0006 amendment 15), and the audit (visa.passports.received). The case
 * stays at Passport back.
 */
export async function receivePassports(caseNo: string, input: ReceivePassportsInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, RECEIVING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  if (input.booklets.current + input.booklets.old < 1) throw fieldError("booklets", "Count at least one booklet.");
  const pre = await gatherReceipt(prisma, enquiry.id);
  assertCanReceive(pre);
  checkStickers(pre, input.stickers);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, RECEIVING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const r = await gatherReceipt(tx, enquiry.id);
    assertCanReceive(r);
    const who = checkStickers(r, input.stickers);

    // A postponed case keeps its due time (its resume day); the update still marks the case changed for open pages.
    const handoverDue = locked.status === "OPEN" || locked.status === "CANCELLED";
    const dueAt = handoverDue ? await dueOnOfficeDay((await getVisaSettings(tx)).handoverCheck, tx) : locked.dueAt;
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: {
        passportsReceivedAt: new Date(),
        passportsReceivedById: actor.user.id,
        bookletsBackCurrent: input.booklets.current,
        bookletsBackOld: input.booklets.old,
      },
    });
    for (const s of input.stickers) {
      await tx.visaCaseTraveller.update({ where: { id: s.travellerId }, data: { stickerCheck: s.check } });
    }
    const sent = bookletsSent({ ...r, travellerCount: r.travellers.length });
    const checks = new Map(input.stickers.map((s) => [s.travellerId, s.check]));
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.passports.received",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { dueAt: locked.dueAt },
        after: {
          booklets: input.booklets,
          intake: sent,
          matchesIntake: sent.current === input.booklets.current && sent.old === input.booklets.old,
          stickers: r.travellers.filter((t) => checks.has(t.id)).map((t) => ({ name: who(t), check: checks.get(t.id) })),
          dueAt,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/** What settling a short return checks, read again under the lock. */
async function gatherShortfall(db: Db, enquiryId: string) {
  const v = await db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      passportsReceivedAt: true,
      bookletsCurrent: true,
      bookletsOld: true,
      bookletsBackCurrent: true,
      bookletsBackOld: true,
      shortfallClearedAt: true,
      handover: { select: { enquiryId: true } },
      _count: { select: { travellers: true } },
    },
  });
  return { ...v, travellerCount: v._count.travellers };
}

type Shortfall = Awaited<ReturnType<typeof gatherShortfall>>;

/** In our stock and short: received, not handed over, and something that went out not back. Returns what's missing. */
function assertShort(s: Shortfall) {
  if (!s.passportsReceivedAt) throw conflict("Mark the passports received first.");
  if (s.handover) throw conflict("The passports are already handed over.");
  const missing = missingBooklets(s);
  if (missing.current + missing.old === 0) throw conflict("Nothing is missing: every booklet that went out is back.");
  return missing;
}

/** Each kind no more than is missing of it, and at least one booklet in all. */
function checkRest(missing: { current: number; old: number }, booklets: ReceiveRestInput["booklets"]) {
  if (booklets.current + booklets.old < 1) throw fieldError("booklets", "Count at least one booklet.");
  for (const kind of ["current", "old"] as const) {
    const n = missing[kind];
    if (booklets[kind] > n) {
      throw fieldError("booklets", n === 0 ? `No ${kind} passport is missing.` : `Only ${n} ${kind} ${n === 1 ? "passport is" : "passports are"} missing.`);
    }
  }
}

/**
 * "Received the rest" of a short return (Decision 5, amended 17 Oct 2026), by whoever can act on the case, whatever its
 * status: the late booklets are added to our stock, each kind up to what's missing of it, even after the shortfall was
 * cleared. In one transaction under the case lock: the new counts; a cleared shortfall dropped once nothing is missing
 * (it was found after all, so reports don't count it); the case marked changed for open pages; and the audit
 * (visa.passports.receivedRest). The due time stays.
 */
export async function receiveRest(caseNo: string, input: ReceiveRestInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, RECEIVING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  checkRest(assertShort(await gatherShortfall(prisma, enquiry.id)), input.booklets);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, RECEIVING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const s = await gatherShortfall(tx, enquiry.id);
    const missing = assertShort(s);
    checkRest(missing, input.booklets);

    const booklets = { current: s.bookletsBackCurrent! + input.booklets.current, old: s.bookletsBackOld! + input.booklets.old };
    const stillMissing = { current: missing.current - input.booklets.current, old: missing.old - input.booklets.old };
    const unclears = !!s.shortfallClearedAt && stillMissing.current + stillMissing.old === 0;
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { updatedAt: new Date() } });
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: {
        bookletsBackCurrent: booklets.current,
        bookletsBackOld: booklets.old,
        ...(unclears ? { shortfallClearedAt: null, shortfallClearedById: null, shortfallReasonId: null } : {}),
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.passports.receivedRest",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { booklets: { current: s.bookletsBackCurrent, old: s.bookletsBackOld }, missing, shortfallCleared: !!s.shortfallClearedAt },
        after: { added: input.booklets, booklets, missing: stillMissing, shortfallCleared: !!s.shortfallClearedAt && !unclears },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/** Short, and not cleared already. Returns what's missing. */
function assertCanClear(s: Shortfall) {
  const missing = assertShort(s);
  if (s.shortfallClearedAt) throw conflict("The shortfall is already cleared.");
  return missing;
}

/** The reason picked: one on the list, switched on. */
async function checkReason(db: Db, reasonId: number) {
  const reason = await db.missingPassportReason.findUnique({ where: { id: reasonId }, select: { name: true, isActive: true } });
  if (!reason?.isActive) throw fieldError("reasonId", "Pick an active reason.");
  return reason.name;
}

/**
 * "Clear the shortfall" (Decision 5, amended 17 Oct 2026), by whoever can act on the case, whatever its status: the
 * missing passports won't come back, and why, picked from the list ⚠️. The handover then goes ahead with what's in our
 * stock. In one transaction under the case lock: when, by whom and why; the case marked changed for open pages; and the
 * audit (visa.passports.shortfallCleared, with what's missing). The due time stays.
 */
export async function clearShortfall(caseNo: string, input: ClearShortfallInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, RECEIVING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertCanClear(await gatherShortfall(prisma, enquiry.id));
  await checkReason(prisma, input.reasonId);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, RECEIVING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const missing = assertCanClear(await gatherShortfall(tx, enquiry.id));
    const reason = await checkReason(tx, input.reasonId);

    await tx.enquiry.update({ where: { id: enquiry.id }, data: { updatedAt: new Date() } });
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: { shortfallClearedAt: new Date(), shortfallClearedById: actor.user.id, shortfallReasonId: input.reasonId },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.passports.shortfallCleared",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        after: { missing, reasonId: input.reasonId, reason },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
