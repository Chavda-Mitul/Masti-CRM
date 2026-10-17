import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { dayLabel, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, notFound } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { countTravellers, travellerLabel } from "../visa/visaCase";
import type { MarkFailedInput } from "./field.schemas";

// The field staff app, the boy's own side (docs/decisions/0015-field-staff-app.md): his run for a day (phase 3), one of
// his stops, and what he records there (phase 4): "Couldn't complete", with a reason from the list and the place his
// phone gave (Decision 5). Only his own stops; he records only booked ones on today's run (past days are read-only,
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
 * a pickup, the papers still pending on the case's checklist (by traveller, leaving out what we arrange ourselves); and
 * once it's finished, when, and why it couldn't be completed.
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

/** One of his stops (phase 4), with today by the server's clock: he records a stop only on its day. */
export async function getMyStop(userId: string, jobId: string) {
  const row = await prisma.fieldJob.findFirst({ where: { id: jobId, assigneeId: userId }, select: stopSelect });
  if (!row) throw notFound("Stop not found.");
  return { stop: toStop(row), today: istToday() };
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
    include: { enquiry: { select: { id: true, caseNo: true, clientId: true, status: true, dueAt: true } } },
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
