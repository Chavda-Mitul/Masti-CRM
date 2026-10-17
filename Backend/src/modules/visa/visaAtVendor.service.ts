import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { addDays, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError } from "../../lib/httpError";
import { blockedDays } from "../holidays/blockedDays";
import { longDay } from "../holidays/holiday";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, loadCase, lockCase, WITH_VENDOR } from "./caseLock";
import { MAX_COLLECTION_DAYS_AHEAD, type SaveSubmissionInput, type VendorReceivedInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueBeforeOfficeDay, dueOnOfficeDay, getVisaSettings } from "./visa.settings";

// Visa Step 5, at the vendor (docs/decisions/0011-visa-at-vendor.md). "Vendor got it, papers checked" (Decision 2) is
// confirmed per file, on its own case page, by whoever can act on the case. The file then comes back due when the vendor
// submits it: the earliest traveller's appointment still to come, or the next open office day at 11:00 ⚠️
// (visa.submissionCheck). An e-visa has no vendor, so it has nothing to confirm.
//
// Then "Submitted at the embassy" (Decisions 3 and 4): the vendor's file number, the embassy and the expected collection
// date, saved together and changeable while the file is at Step 5. The date can't be one the embassy is closed (its
// holidays and the weekly Sunday, from the holiday calendar). The file comes back due the office day before it ⚠️
// (visa.collectionCheck). With appointments booked (Step 3), the file is marked submitted only from the earliest
// appointment day, and the collection date is after the latest one (decided 16 Oct 2026).

/** What "Vendor got it" and "Submitted" check, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      vendorReceivedAt: true,
      docket: { select: { docketNo: true } },
      travellers: { select: { appointmentAt: true } },
      submittedAt: true,
      vendorFileNo: true,
      embassyId: true,
      collectionOn: true,
      offering: { select: { countryId: true, country: { select: { name: true } } } },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * When the file comes back due after "Vendor got it": the earliest appointment still to come, when the vendor submits
 * it; with none, the next open office day at 11:00 ⚠️.
 */
async function dueAfterReceipt(db: Db, g: Gathered) {
  const now = Date.now();
  const appointments = g.travellers.map((t) => t.appointmentAt).filter((at): at is Date => !!at && at.getTime() > now);
  if (appointments.length) {
    return { dueAt: new Date(Math.min(...appointments.map((at) => at.getTime()))), dueReason: "APPOINTMENT" as const };
  }
  return { dueAt: await dueOnOfficeDay((await getVisaSettings(db)).submissionCheck, db), dueReason: "NEXT_DAY" as const };
}

/**
 * The travellers' embassy appointments as days in India: the earliest (the vendor can't submit before it) and the latest
 * (nothing is collected before everyone has been in). Null when none is booked: an e-visa, or a visa without appointments.
 */
function appointmentDays(g: Gathered) {
  const days = g.travellers.flatMap((t) => (t.appointmentAt ? [istToday(t.appointmentAt)] : [])).sort();
  return days.length ? { earliest: days[0]!, latest: days.at(-1)! } : null;
}

function assertCanConfirm(g: Gathered) {
  if (!g.docket) throw conflict("This file went in online: there's no vendor to confirm.");
  if (g.vendorReceivedAt) throw conflict("The vendor already has this file: it's recorded.");
}

/** The dialog's first look: when the file comes back due, and why then. */
export async function vendorReceivedCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  return dueAfterReceipt(prisma, await gather(prisma, id));
}

/**
 * "Vendor got it, papers checked" (Decision 2). In one transaction: who and when are stamped on this file only, it
 * comes back due at the appointment (or the next office day), and it's audited. The other files in its docket don't
 * change.
 */
export async function markVendorReceived(caseNo: string, input: VendorReceivedInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, WITH_VENDOR);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertCanConfirm(await gather(prisma, enquiry.id));

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, WITH_VENDOR);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertCanConfirm(g);

    const { dueAt, dueReason } = await dueAfterReceipt(tx, g);
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { vendorReceivedAt: new Date(), vendorReceivedById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.vendorReceived",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { dueAt: locked.dueAt },
        after: { dueAt, dueReason, docketNo: g.docket!.docketNo },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * Whether this file can be marked submitted: it went by docket, and the vendor got it. The first save waits for the
 * earliest appointment day; a change later doesn't.
 */
function assertCanSubmit(g: Gathered) {
  if (!g.docket) throw conflict("This file went in online: there's no vendor file number.");
  if (!g.vendorReceivedAt) throw conflict("Confirm the vendor got it first.");
  const appointments = appointmentDays(g);
  if (!g.submittedAt && appointments && istToday() < appointments.earliest) {
    throw conflict(`The embassy appointment is ${longDay(appointments.earliest)}. Mark it submitted on that day or after.`);
  }
}

/**
 * An embassy of the case's country, switched on. The one already on the case stays allowed if it was switched off
 * since, so its date can still be moved.
 */
async function checkEmbassy(db: Db, embassyId: number, g: Gathered) {
  const embassy = await db.embassy.findUnique({ where: { id: embassyId }, select: { id: true, name: true, countryId: true, isActive: true } });
  if (!embassy || embassy.countryId !== g.offering.countryId) throw fieldError("embassyId", `Pick an embassy for ${g.offering.country.name}.`);
  if (!embassy.isActive && embassy.id !== g.embassyId) throw fieldError("embassyId", `${embassy.name} is switched off. Pick another.`);
  return embassy;
}

/**
 * After today and after the latest appointment, within a year, and not a day the embassy is closed (its holidays and
 * the weekly Sunday).
 */
async function checkCollectionOn(db: Db, date: string, embassy: { id: number; name: string }, g: Gathered) {
  const today = istToday();
  if (date <= today) throw fieldError("collectionOn", "Pick a day after today.");
  const appointments = appointmentDays(g);
  if (appointments && date <= appointments.latest) {
    throw fieldError("collectionOn", `Pick a day after the appointment (${longDay(appointments.latest)}).`);
  }
  if (date > addDays(today, MAX_COLLECTION_DAYS_AHEAD)) throw fieldError("collectionOn", "Pick a day within the next year.");
  const [closed] = await blockedDays(date, date, { embassyId: embassy.id }, db);
  if (closed) {
    const why = closed.holidays.map((h) => h.name).join(", ");
    throw fieldError("collectionOn", `${why}: ${embassy.name} is closed that day. Pick another.`);
  }
}

/**
 * "Submitted at the embassy" (Decisions 3 and 4), or a change to it later at Step 5. In one transaction: the file number,
 * the embassy and the collection date are saved; the first save stamps who and when; the file comes back due the
 * office day before the date; and it's audited (visa.submitted, then visa.submission.update with the old values). A
 * save that changes nothing writes nothing.
 */
export async function saveSubmission(caseNo: string, input: SaveSubmissionInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, WITH_VENDOR);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  assertCanSubmit(pre);
  await checkCollectionOn(prisma, input.collectionOn, await checkEmbassy(prisma, input.embassyId, pre), pre);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, WITH_VENDOR);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertCanSubmit(g);
    const embassy = await checkEmbassy(tx, input.embassyId, g);
    await checkCollectionOn(tx, input.collectionOn, embassy, g);

    const was = g.submittedAt && { vendorFileNo: g.vendorFileNo, embassyId: g.embassyId, collectionOn: fromDbDate(g.collectionOn!) };
    const now = { vendorFileNo: input.vendorFileNo, embassyId: embassy.id, collectionOn: input.collectionOn };
    if (was && was.vendorFileNo === now.vendorFileNo && was.embassyId === now.embassyId && was.collectionOn === now.collectionOn) return;

    const dueAt = await dueBeforeOfficeDay(input.collectionOn, (await getVisaSettings(tx)).collectionCheck, tx);
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: {
        vendorFileNo: now.vendorFileNo,
        embassyId: now.embassyId,
        collectionOn: toDbDate(now.collectionOn),
        ...(was ? {} : { submittedAt: new Date(), submittedById: actor.user.id }),
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: was ? "visa.submission.update" : "visa.submitted",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { ...(was ?? {}), dueAt: locked.dueAt },
        after: { ...now, embassy: embassy.name, dueAt },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
