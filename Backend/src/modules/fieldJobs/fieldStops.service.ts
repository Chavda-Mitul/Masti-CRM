import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { dayLabel, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { sendEmail } from "../../lib/email";
import { badRequest, conflict, fieldError, HttpError, notFound } from "../../lib/httpError";
import { checkWarnings, confirmedWarningsNote } from "../../lib/warnings";
import { imageType, type ImageType } from "../../lib/images";
import { logger } from "../../lib/logger";
import { MB } from "../../lib/pdf";
import { deleteObject, putObject } from "../../lib/storage";
import { getCompanyDetails } from "../company/company.settings";
import type { Actor } from "../users/user";
import { countTravellers, travellerLabel } from "../visa/visaCase";
import { advanceToDocuments } from "../visa/visaSteps.service";
import { assertInStock, checkHandover, deliverCase, gather as gatherHandover, receiverWarnings } from "../visa/visaHandover.service";
import type { FieldSettings, HandOverAtDoorInput, MarkDoneInput, MarkFailedInput } from "./field.schemas";
import { getFieldSettings } from "./fieldJobs.settings";
import { otpEmail } from "./otpEmail";

// The field staff app, the boy's own side (docs/decisions/0015-field-staff-app.md): his run for a day (phase 3), one of
// his stops, and what he records there (phase 4): "Couldn't complete", with a reason from the list and the place his
// phone gave (Decision 5); or, at the door (Decision 4), the client's one-time code by email, the booklets he counted
// and his selfie with the place: "Picked up" at a pickup (phase 4), the handover at a delivery, with a photo of the
// person receiving (phase 5). Only his own stops; he records only booked ones on today's run (past days are read-only,
// decided 17 Oct 2026). The office's side is in visa/visaFieldJobs.service.ts.

/** What his phone shows of a stop: just what it needs, never the case page, money or documents (0015 phase 3). */
const stopSelect = {
  id: true,
  kind: true,
  status: true,
  day: true,
  address: true,
  mapLink: true,
  mobile: true,
  finishedAt: true,
  department: { select: { code: true } },
  slot: { select: { name: true, startsAt: true, endsAt: true } },
  failReason: { select: { name: true } },
  enquiry: {
    select: {
      caseNo: true,
      client: { select: { name: true } },
      visa: {
        select: {
          bookletsBackCurrent: true,
          bookletsBackOld: true,
          travellers: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              isChild: true,
              name: true,
              documents: {
                where: { status: "PENDING", requirement: { not: "ARRANGED_BY_US" } },
                orderBy: { sortOrder: "asc" },
                select: { name: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.FieldJobSelect;

type StopRow = Prisma.FieldJobGetPayload<{ select: typeof stopSelect }>;

/**
 * One stop as his phone shows it: the desk that raised it, the day and slot, the client's name, the case number, where
 * to go (the address, the Google Maps link), whom to call; for a delivery, the booklets in our stock he hands over; for
 * a pickup, the papers still pending on the case's checklist (by traveller, leaving out what we arrange ourselves); for
 * a delivery, the travellers, to pick who receives (names only); and once it's finished, when, and why it couldn't be
 * completed.
 */
function toStop(j: StopRow) {
  const visa = j.enquiry.visa;
  const adults = visa ? countTravellers(visa.travellers).adults : 0;
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    department: j.department.code,
    day: fromDbDate(j.day),
    slot: j.slot,
    caseNo: j.enquiry.caseNo,
    client: j.enquiry.client,
    address: j.address,
    mapLink: j.mapLink,
    mobile: j.mobile,
    booklets:
      j.kind === "DELIVERY" && visa && visa.bookletsBackCurrent !== null && visa.bookletsBackOld !== null
        ? { current: visa.bookletsBackCurrent, old: visa.bookletsBackOld }
        : null,
    pending:
      j.kind === "PICKUP" && visa
        ? visa.travellers.flatMap((t) => t.documents.map((d) => ({ document: d.name, traveller: t.name ?? travellerLabel(t, adults) })))
        : [],
    // Who may receive the passports at the door; a child is marked, as handing them to one is a warning (19 Oct 2026).
    travellers: j.kind === "DELIVERY" && visa ? visa.travellers.map((t) => ({ id: t.id, name: t.name ?? travellerLabel(t, adults), isChild: t.isChild })) : [],
    finishedAt: j.finishedAt,
    failReason: j.failReason?.name ?? null,
  };
}

/**
 * His run for a day (phase 3): his own jobs only, in slot order, then by when they were booked; cancelled stops come
 * last, so he knows not to go. "Done" counts finished stops (done or couldn't complete) among the ones not cancelled.
 * Today (India) is the day when none is asked for, and comes back too, so his phone names the days around it
 * ("Yesterday", "Tomorrow") by the server's clock.
 */
export async function listMyJobs(userId: string, asked: string | undefined) {
  const today = istToday();
  const day = asked ?? today;
  const rows = await prisma.fieldJob.findMany({
    where: { assigneeId: userId, day: toDbDate(day) },
    orderBy: [{ slot: { startsAt: "asc" } }, { createdAt: "asc" }],
    select: stopSelect,
  });
  const jobs = rows.map(toStop);
  const live = jobs.filter((j) => j.status !== "CANCELLED");
  return {
    day,
    today,
    jobs: [...live, ...jobs.filter((j) => j.status === "CANCELLED")],
    done: live.filter((j) => j.status === "DONE" || j.status === "FAILED").length,
    total: live.length,
  };
}

/** "h•••@example.com": enough for the client to know where to look, not the whole address. */
const maskEmail = (email: string) => {
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : "•••";
};

/**
 * Where the client's code stands, as his phone shows it: where it went (masked), until when it works, when he may send
 * another, and when the client confirmed it. Null until one is sent.
 */
function otpState(j: { otpSentAt: Date | null; otpSentTo: string | null; otpExpiresAt: Date | null; otpConfirmedAt: Date | null }, settings: FieldSettings) {
  if (!j.otpSentAt || !j.otpSentTo || !j.otpExpiresAt) return null;
  return {
    sentTo: maskEmail(j.otpSentTo),
    sentAt: j.otpSentAt,
    expiresAt: j.otpExpiresAt,
    resendAt: new Date(j.otpSentAt.getTime() + settings.otpResendSeconds * 1000),
    confirmedAt: j.otpConfirmedAt,
  };
}

/** One of his stops (phase 4), with where its code stands and today by the server's clock: he records a stop only on its day. */
export async function getMyStop(userId: string, jobId: string) {
  const row = await prisma.fieldJob.findFirst({
    where: { id: jobId, assigneeId: userId },
    select: { ...stopSelect, otpSentAt: true, otpSentTo: true, otpExpiresAt: true, otpConfirmedAt: true },
  });
  if (!row) throw notFound("Stop not found.");
  return { stop: toStop(row), otp: otpState(row, await getFieldSettings()), today: istToday() };
}

/** The reasons his phone offers for "Couldn't complete" (Decision 5): the ones switched on, in the list's order. */
export async function listFailReasons() {
  return prisma.fieldFailReason.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * Something he records happens only on a booked stop of today's run: a called-off stop isn't visited, a finished one
 * isn't recorded twice, and another day's waits for its day, or for the office to book it again.
 */
function assertCanRecord(job: { status: string; day: Date }) {
  if (job.status === "CANCELLED") throw conflict("The office called this stop off.");
  if (job.status !== "BOOKED") throw conflict("This stop is already recorded.");
  const day = fromDbDate(job.day);
  const today = istToday();
  if (day < today) throw conflict(`This stop was on ${dayLabel(day)}. Ask the office to book it again.`);
  if (day > today) throw conflict(`This stop is on ${dayLabel(day)}. Record it on the day.`);
}

/** "Picked up" is a pickup's (phase 4b). */
function assertPickup(job: { kind: string }) {
  if (job.kind !== "PICKUP") throw conflict("Only a pickup is recorded this way.");
}

/** The handover at the door, and the photo of the person receiving, are a delivery's (phase 5). */
function assertDelivery(job: { kind: string }) {
  if (job.kind !== "DELIVERY") throw conflict("Only a delivery is handed over this way.");
}

/**
 * His stop, for something he records, in the caller's transaction: the case's row is locked first, then the job's (the
 * office's order: booking, changing and calling the boy off lock the case first), and the job read again under them.
 * Refused unless it's his (a stop given to another boy meanwhile is no longer found), booked, and on today's run.
 */
export async function lockMyJob(tx: Db, jobId: string, actor: Actor) {
  const found = await tx.fieldJob.findFirst({ where: { id: jobId, assigneeId: actor.user.id }, select: { enquiryId: true } });
  if (!found) throw notFound("Stop not found.");
  await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ${found.enquiryId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "FieldJob" WHERE "id" = ${jobId} FOR UPDATE`;
  const job = await tx.fieldJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      enquiry: {
        select: {
          id: true,
          caseNo: true,
          clientId: true,
          status: true,
          dueAt: true,
          stageId: true,
          departmentId: true,
          stage: { select: { code: true } },
          client: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (job.assigneeId !== actor.user.id) throw notFound("Stop not found.");
  assertCanRecord(job);
  return job;
}

/**
 * "Couldn't complete" (Decision 5), by the boy at the door, for either kind of stop: a reason from the list (switched
 * on) and the place his phone gave. In one transaction under the case's lock: the stop fails, with when, where and why;
 * the case comes back to the office due now, to book again (a postponed or cancelled case keeps its own due time); and
 * the case's updatedAt moves, so an office page left open over it is refused rather than writing over it. Audited
 * (field.job.fail), with the place.
 */
export async function markFailed(jobId: string, input: MarkFailedInput, actor: Actor) {
  const reason = await prisma.fieldFailReason.findUnique({ where: { id: input.reasonId } });
  if (!reason?.isActive) throw fieldError("reasonId", "Pick one of the reasons.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const job = await lockMyJob(tx, jobId, actor);
    const dueAt = job.enquiry.status === "OPEN" ? now : job.enquiry.dueAt;
    await tx.fieldJob.update({
      where: { id: jobId },
      data: { status: "FAILED", finishedAt: now, failReasonId: reason.id, latitude: input.place.lat, longitude: input.place.lng, accuracyM: input.place.accuracy },
    });
    await tx.enquiry.update({ where: { id: job.enquiry.id }, data: { dueAt, updatedAt: now } });
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.fail",
        entityType: "FieldJob",
        entityId: jobId,
        clientId: job.enquiry.clientId,
        before: { status: "BOOKED", dueAt: job.enquiry.dueAt },
        after: { status: "FAILED", kind: job.kind, caseNo: job.enquiry.caseNo, reason: reason.name, place: input.place, finishedAt: now, dueAt },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getMyStop(actor.user.id, jobId);
}

// ---------------------------------------------------------------------------
// The client's one-time code (Decision 4)
// ---------------------------------------------------------------------------

/** Only a hash of the code is kept: sha256 of the job and the code. */
const hashCode = (jobId: string, code: string) => createHash("sha256").update(`${jobId}:${code}`).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * "Send the code" (Decision 4): a new 6-digit code to the client's email as it is now, working for the setting's
 * minutes (field.otpMinutes ⚠️), a new one only after field.otpResendSeconds ⚠️, never once the client has confirmed.
 * The code (its hash only) is stored first, under the job's lock; the email goes outside any transaction (the mail
 * server can be slow). If it doesn't go, this code is cleared again, so no code the client never saw stays live, and
 * he's told why (502). Audited either way (field.otp.send).
 */
export async function sendOtp(jobId: string, actor: Actor) {
  const settings = await getFieldSettings();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + settings.otpMinutes * 60_000);
  const job = await prisma.$transaction(async (tx) => {
    const locked = await lockMyJob(tx, jobId, actor);
    if (locked.otpConfirmedAt) throw conflict("The client has already confirmed with the code.");
    const readyAt = locked.otpSentAt ? locked.otpSentAt.getTime() + settings.otpResendSeconds * 1000 : 0;
    if (readyAt > now.getTime()) throw conflict(`Wait ${Math.ceil((readyAt - now.getTime()) / 1000)} seconds, then send a new code.`);
    const email = locked.enquiry.client.email;
    if (!email) {
      throw new HttpError(409, "The client has no email on file, so the code can't go. Call the office.", { code: "CLIENT_EMAIL_MISSING" });
    }
    await tx.fieldJob.update({
      where: { id: jobId },
      data: { otpHash: hashCode(jobId, code), otpSentAt: now, otpSentTo: email, otpExpiresAt: expiresAt, otpTries: 0 },
    });
    return { ...locked, email };
  });

  const company = await getCompanyDetails();
  const entry = { actorId: actor.user.id, action: "field.otp.send", entityType: "FieldJob", entityId: jobId, clientId: job.enquiry.clientId, ip: actor.ip };
  try {
    await sendEmail(
      otpEmail({
        to: job.email,
        client: firstWord(job.enquiry.client.name),
        boy: firstWord(actor.user.name),
        company: { name: company.name, phone: company.phone || null, email: company.email },
        caseNo: job.enquiry.caseNo,
        kind: job.kind,
        code,
        minutes: settings.otpMinutes,
      }),
    );
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    logger.error({ err, jobId }, "The client's one-time code couldn't be sent.");
    // Only this send's code is cleared: one sent after it stays.
    await prisma.fieldJob.updateMany({
      where: { id: jobId, otpSentAt: now, otpConfirmedAt: null },
      data: { otpHash: null, otpSentAt: null, otpSentTo: null, otpExpiresAt: null, otpTries: 0 },
    });
    await audit({ ...entry, after: { sent: false, to: job.email, error: reason } });
    throw new HttpError(502, `Couldn't send the code: ${reason}`);
  }
  await audit({ ...entry, after: { sent: true, to: job.email, expiresAt } });
  return getMyStop(actor.user.id, jobId);
}

/**
 * "Check" the code the client reads out (Decision 4), under the job's lock: refused once it has expired or after the
 * setting's wrong tries (field.otpTries ⚠️), until a new one is sent. A wrong try is counted and audited
 * (field.otp.wrong): its transaction commits first, and the refusal is thrown after it. The right code confirms the
 * client (field.otp.confirm); checking again after that changes nothing.
 */
export async function checkOtp(jobId: string, code: string, actor: Actor) {
  const settings = await getFieldSettings();
  const now = new Date();
  const refusal = await prisma.$transaction(async (tx) => {
    const job = await lockMyJob(tx, jobId, actor);
    if (job.otpConfirmedAt) return null;
    if (!job.otpHash || !job.otpExpiresAt) throw conflict("Send the code first.");
    if (job.otpExpiresAt <= now) return "This code has expired. Send a new one.";
    if (job.otpTries >= settings.otpTries) return "Too many wrong tries. Send a new code.";
    const entry = { actorId: actor.user.id, entityType: "FieldJob", entityId: jobId, clientId: job.enquiry.clientId, ip: actor.ip };
    if (!sameHash(job.otpHash, hashCode(jobId, code))) {
      const tries = job.otpTries + 1;
      const left = settings.otpTries - tries;
      await tx.fieldJob.update({ where: { id: jobId }, data: { otpTries: tries } });
      await audit({ ...entry, action: "field.otp.wrong", after: { tries, left } }, tx);
      return left > 0 ? `That's not the code. ${left} ${left === 1 ? "try" : "tries"} left.` : "That's not the code, and that was the last try. Send a new code.";
    }
    await tx.fieldJob.update({ where: { id: jobId }, data: { otpConfirmedAt: now } });
    await audit({ ...entry, action: "field.otp.confirm", after: { confirmedAt: now, sentTo: job.otpSentTo } }, tx);
    return null;
  });
  if (refusal) throw fieldError("code", refusal);
  return getMyStop(actor.user.id, jobId);
}

// ---------------------------------------------------------------------------
// The photos at the door, "Picked up", and the handover (Decision 4)
// ---------------------------------------------------------------------------

type DoorPhotoKind = "FIELD_SELFIE" | "RECEIVER_PHOTO";

/** His selfie, at either kind of stop; the photo of the person receiving, at a delivery only. */
function assertPhotoFits(job: { kind: string }, kind: DoorPhotoKind) {
  if (kind === "RECEIVER_PHOTO") assertDelivery(job);
}

/**
 * Before a photo is read: it must be for a stop of his he can record now, and the setting gives the size limit
 * (field.selfieMaxMb ⚠️, for both photos). Refusing here means a wrong upload is never held in memory.
 */
export async function photoLimit(jobId: string, kind: DoorPhotoKind, actor: Actor) {
  const job = await prisma.fieldJob.findFirst({ where: { id: jobId, assigneeId: actor.user.id }, select: { kind: true, status: true, day: true } });
  if (!job) throw notFound("Stop not found.");
  assertCanRecord(job);
  assertPhotoFits(job, kind);
  const { selfieMaxMb } = await getFieldSettings();
  return { maxBytes: selfieMaxMb * MB, tooBig: `This photo is over ${selfieMaxMb} MB. Take it again.` };
}

/**
 * Saves a photo taken at the door as soon as he takes it (Decision 4): his selfie (FIELD_SELFIE), or at a delivery the
 * person receiving (RECEIVER_PHOTO); really the JPEG or PNG it says it is, in the private bucket under a key no other
 * upload shares, as a case file of its own. The bucket upload happens before the lock; under it the checks are
 * repeated, and if they fail now the object is removed again. "Picked up" or the handover links it.
 */
export async function uploadDoorPhoto(jobId: string, kind: DoorPhotoKind, bytes: Buffer, contentType: ImageType, actor: Actor) {
  if (bytes.length === 0) throw badRequest("Take the photo first.");
  if (imageType(bytes) !== contentType) throw badRequest(`This isn't a ${contentType === "image/png" ? "PNG" : "JPEG"} photo. Take it again.`);
  const job = await prisma.fieldJob.findFirst({
    where: { id: jobId, assigneeId: actor.user.id },
    select: { kind: true, status: true, day: true, enquiryId: true, enquiry: { select: { caseNo: true } } },
  });
  if (!job) throw notFound("Stop not found.");
  assertCanRecord(job);
  assertPhotoFits(job, kind);
  const extension = contentType === "image/png" ? "png" : "jpg";
  const fileName = `${job.enquiry.caseNo}_${kind === "FIELD_SELFIE" ? "selfie" : "receiver"}.${extension}`;
  const storageKey = `cases/${job.enquiryId}/field/${randomUUID()}.${extension}`;
  await putObject(storageKey, bytes, contentType);

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockMyJob(tx, jobId, actor);
      assertPhotoFits(locked, kind);
      const file = await tx.caseFile.create({
        data: { enquiryId: locked.enquiryId, kind, storageKey, fileName, sizeBytes: bytes.length, uploadedById: actor.user.id },
        select: { id: true, fileName: true, uploadedAt: true },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "visa.file.upload",
          entityType: "CaseFile",
          entityId: file.id,
          clientId: locked.enquiry.clientId,
          after: { kind, jobId, fileName, sizeBytes: bytes.length, storageKey },
          ip: actor.ip,
        },
        tx,
      );
      return file;
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
}

/** A photo he took at this stop's door, of the kind asked for, for this case, and not proving anything yet. */
async function checkDoorPhoto(db: Db, enquiryId: string, fileId: string, kind: DoorPhotoKind, actor: Actor, field: string, message: string) {
  const file = await db.caseFile.findUnique({
    where: { id: fileId },
    select: { enquiryId: true, kind: true, uploadedById: true, fieldJob: { select: { id: true } }, handover: { select: { enquiryId: true } } },
  });
  if (!file || file.enquiryId !== enquiryId || file.kind !== kind || file.uploadedById !== actor.user.id || file.fieldJob || file.handover) {
    throw fieldError(field, message);
  }
}

/**
 * "Picked up" (Decision 4): once the client confirmed with the code, the booklets he counted, his selfie at the door
 * (taken by him, for this case, not used before) and the place. In one transaction under the case's lock: the stop is
 * done, with when, where and the proof; his count becomes the case's intake count; a case still at Step 1 moves to
 * Documents, as any Step 2 write does; and the case's updatedAt moves, so an office page left open over it is refused
 * rather than writing over his count. Audited (field.job.done, with the place; visa.case.update for the booklets). The
 * papers are still ticked and scanned at the office; the case keeps its due time.
 */
export async function markDone(jobId: string, input: MarkDoneInput, actor: Actor) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const job = await lockMyJob(tx, jobId, actor);
    assertPickup(job);
    const { enquiry } = job;
    if (enquiry.status !== "OPEN" || !["ENQUIRY", "DOCUMENTS"].includes(enquiry.stage.code)) {
      throw conflict("This case has moved on from collecting documents. Call the office.");
    }
    if (!job.otpConfirmedAt) throw conflict("The client hasn't confirmed with the code yet.");
    await checkDoorPhoto(tx, enquiry.id, input.selfieId, "FIELD_SELFIE", actor, "selfieId", "Take your selfie at the door.");

    const before = await tx.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id }, select: { bookletsCurrent: true, bookletsOld: true } });
    const { current, old } = input.booklets;
    await tx.fieldJob.update({
      where: { id: jobId },
      data: {
        status: "DONE",
        finishedAt: now,
        bookletsCurrent: current,
        bookletsOld: old,
        selfieId: input.selfieId,
        latitude: input.place.lat,
        longitude: input.place.lng,
        accuracyM: input.place.accuracy,
      },
    });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { bookletsCurrent: current, bookletsOld: old } });
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { updatedAt: now } });
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.done",
        entityType: "FieldJob",
        entityId: jobId,
        clientId: enquiry.clientId,
        before: { status: "BOOKED" },
        after: {
          status: "DONE",
          kind: job.kind,
          caseNo: enquiry.caseNo,
          booklets: input.booklets,
          selfieId: input.selfieId,
          otpConfirmedAt: job.otpConfirmedAt,
          place: input.place,
          finishedAt: now,
        },
        ip: actor.ip,
      },
      tx,
    );
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.case.update",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before,
        after: { bookletsCurrent: current, bookletsOld: old },
        ip: actor.ip,
      },
      tx,
    );
    await advanceToDocuments(tx, enquiry, actor);
  });
  return getMyStop(actor.user.id, jobId);
}

/**
 * The handover at the client's door (Decision 4, phase 5), once the client confirmed with the code: the booklets he
 * counted must match our stock, as at the office (otherwise he brings them back and uses Couldn't complete, decided 17
 * Oct 2026); who receives them, a traveller on the case or someone else by name, and the photo he took of them; his
 * selfie; and the place. In one transaction under the case's lock: the stop is done, with when, where and the proof;
 * the handover (mode DELIVERY) points at it; the case moves to Delivered and closes (a cancelled one stays cancelled),
 * as at the office. Audited: visa.handover (with the job and the place) and field.job.done.
 */
export async function handOverAtDoor(jobId: string, input: HandOverAtDoorInput, actor: Actor) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const job = await lockMyJob(tx, jobId, actor);
    assertDelivery(job);
    const { enquiry } = job;
    if (!job.otpConfirmedAt) throw conflict("The client hasn't confirmed with the code yet.");
    const g = await gatherHandover(tx, enquiry.id);
    const receiver = checkHandover(g, assertInStock(g, enquiry), input);
    const confirmed = checkWarnings(await receiverWarnings(tx, g, input.receiver), input.confirmWarnings);
    await checkDoorPhoto(tx, enquiry.id, input.photoId, "RECEIVER_PHOTO", actor, "photoId", "Take a photo of the person receiving.");
    await checkDoorPhoto(tx, enquiry.id, input.selfieId, "FIELD_SELFIE", actor, "selfieId", "Take your selfie at the door.");

    const { current, old } = input.booklets;
    await tx.fieldJob.update({
      where: { id: jobId },
      data: {
        status: "DONE",
        finishedAt: now,
        bookletsCurrent: current,
        bookletsOld: old,
        selfieId: input.selfieId,
        latitude: input.place.lat,
        longitude: input.place.lng,
        accuracyM: input.place.accuracy,
      },
    });
    // After the job is done, so only other booked jobs are called off.
    const { closes, fieldJobsCancelled } = await deliverCase(tx, enquiry, actor, "handed over at the door");
    await tx.visaHandover.create({
      data: {
        enquiryId: enquiry.id,
        mode: "DELIVERY",
        at: now,
        byId: actor.user.id,
        bookletsCurrent: current,
        bookletsOld: old,
        receiverTravellerId: input.receiver.travellerId ?? null,
        receiverName: input.receiver.name ?? null,
        receiverPhotoId: input.photoId,
        fieldJobId: jobId,
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.handover",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: "PASSPORT_BACK", status: enquiry.status, dueAt: enquiry.dueAt },
        after: {
          stage: "DELIVERED",
          status: closes ? "CLOSED" : enquiry.status,
          mode: "DELIVERY",
          booklets: input.booklets,
          receiver,
          receiverIsTraveller: !!input.receiver.travellerId,
          photoId: input.photoId,
          fieldJobId: jobId,
          place: input.place,
          ...(fieldJobsCancelled.length > 0 ? { fieldJobsCancelled } : {}),
          ...confirmedWarningsNote(confirmed),
        },
        ip: actor.ip,
      },
      tx,
    );
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.done",
        entityType: "FieldJob",
        entityId: jobId,
        clientId: enquiry.clientId,
        before: { status: "BOOKED" },
        after: {
          status: "DONE",
          kind: job.kind,
          caseNo: enquiry.caseNo,
          booklets: input.booklets,
          selfieId: input.selfieId,
          otpConfirmedAt: job.otpConfirmedAt,
          place: input.place,
          finishedAt: now,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getMyStop(actor.user.id, jobId);
}
