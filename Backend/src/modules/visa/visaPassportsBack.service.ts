import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { addDays, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError } from "../../lib/httpError";
import { blockedDays } from "../holidays/blockedDays";
import type { Actor } from "../users/user";
import { IN_TRANSIT, loadCase, lockCase, RECEIVING, RETURNING, visaStage } from "./caseLock";
import { MAX_COLLECTION_DAYS_AHEAD, type ReceivePassportsInput, type SendPassportsBackInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { travellerLabel } from "./visaCase";

// Visa Step 7, passport back (docs/decisions/0013-visa-passport-back.md). "Passports on the way back" records the day
// the vendor collected the passports and the day they're expected at our office (Decision 3), from Decision, or at
// Passport back for a recalled file. The passports are then in transit until they're marked received, and the case is
// due on the expected day at 11:00 ⚠️ (visa.arrivalCheck). While they're in transit, "Change" corrects either day
// (component 2). "Mark received" puts them in our stock, with the booklets counted and the stickers checked
// (Decision 5, component 3). An e-visa's passports never left the office, so it waits at Decision (Decision 4).

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
 * "Passports on the way back" (Decision 3), by whoever can act on the case, while it's open. In one transaction under
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

/** What went to the vendor, as the docket counted it (0008 Decision 4): the current booklets (else one per traveller) and the old ones. */
function bookletsSent(r: Receipt) {
  return { current: r.bookletsCurrent ?? r.travellers.length, old: r.bookletsOld ?? 0 };
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
 * match, is recorded and shown, not refused. In one transaction under the case lock: who received them and when, the
 * booklets, each approved traveller's sticker check, the due time to arrange the handover (an open case only:
 * visa.handoverCheck ⚠️), and the audit (visa.passports.received). The case stays at Passport back.
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

    // A postponed or cancelled case keeps its due time; the update still marks the case changed for open pages.
    const dueAt = locked.status === "OPEN" ? await dueOnOfficeDay((await getVisaSettings(tx)).handoverCheck, tx) : locked.dueAt;
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
    const sent = bookletsSent(r);
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
