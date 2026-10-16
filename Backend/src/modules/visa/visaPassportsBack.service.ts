import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { addDays, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError } from "../../lib/httpError";
import { blockedDays } from "../holidays/blockedDays";
import type { Actor } from "../users/user";
import { loadCase, lockCase, RETURNING, visaStage } from "./caseLock";
import { MAX_COLLECTION_DAYS_AHEAD, type SendPassportsBackInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";

// Visa Step 7, passport back (docs/decisions/0013-visa-passport-back.md). "Passports on the way back" records the day
// the vendor collected the passports and the day they're expected at our office (Decision 3), from Decision, or at
// Passport back for a recalled file. The passports are then in transit until they're marked received, and the case is
// due on the expected day at 11:00 ⚠️ (visa.arrivalCheck). An e-visa's passports never left the office, so it waits at
// Decision (Decision 4).

/** What sending the passports back checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedOnlineAt: true,
      passportsInTransitAt: true,
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

/**
 * The vendor collected them today or earlier, not before the file was dispatched. They're expected today or later (so
 * never before they were collected), within a year, on a day our office is open (Sundays and office holidays are
 * refused, by name).
 */
async function checkDates(db: Db, input: SendPassportsBackInput, g: Gathered) {
  const today = istToday();
  const dispatchedOn = g.docket?.dispatchedAt ? istToday(g.docket.dispatchedAt) : null;
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
