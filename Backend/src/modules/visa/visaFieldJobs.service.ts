import type { FieldJobKind } from "../../../generated/prisma/enums";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { addDays, dayLabel, fromDbDate, istDateTimeToUtc, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, notFound } from "../../lib/httpError";
import { blockedDays } from "../holidays/blockedDays";
import { VISA_COLLECTION_VISIT, VISA_DELIVERY_VISIT } from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";
import type { Actor } from "../users/user";
import { COLLECTING, HANDING_OVER, loadCase, lockCase, type StepRule } from "./caseLock";
import { assertNotHeldShort } from "./shortfall";
import { MAX_COLLECTION_DAYS_AHEAD, type BookFieldJobInput, type ChangeFieldJobInput, type MatureCaseInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { visaMessageBasics } from "./visaMessages";

// The field staff app, the office side (docs/decisions/0015-field-staff-app.md): booking the collection boy to pick a
// case's documents up at Steps 1–2 (phase 1), or the delivery boy to take its passports to the client once they're in
// our stock (phase 2). Staff pick the boy (an active FIELD user), an open office day and a time slot from the list
// (Decision 2); the address is copied from the client's (correctable), with an optional Google Maps link (Decision 3).
// The one-time code the client gives the boy goes to their WhatsApp (Decision 4, amended 22 Oct 2026), so no email is
// needed. One booked job of each kind per case, kept by the case lock; it can be changed or cancelled while booked.
// While it's booked, an open case is due at the slot's end that day, to check it happened.

/**
 * The step each kind of job is booked at: a pickup while the documents are collected (the case's owner, the HOD or the
 * Head); a delivery from Passport back, by any Visa staff with EDIT, whatever the case's status (as the office handover).
 */
const RULE: Record<FieldJobKind, StepRule> = { PICKUP: COLLECTING, DELIVERY: HANDING_OVER };

/**
 * What booking checks, read again under the lock: the client's mobile, a job of this kind already booked, and (for a
 * delivery) whether the passports are in our stock.
 */
async function gather(db: Db, enquiryId: string, kind: FieldJobKind) {
  return db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      client: { select: { mobile: true } },
      fieldJobs: { where: { kind, status: "BOOKED" }, select: { id: true } },
      visa: {
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
      },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * One booked job of a kind per case (0015 Defaults); a delivery only of passports in our stock, and not while a short
 * return holds them (0013 Decision 5, amended 17 Oct 2026).
 */
function assertCanBook(g: Gathered, kind: FieldJobKind) {
  if (kind === "DELIVERY" && !g.visa?.passportsReceivedAt) throw conflict("Mark the passports received first.");
  if (kind === "DELIVERY" && g.visa?.handover) throw conflict("The passports are already handed over.");
  if (kind === "DELIVERY" && g.visa) assertNotHeldShort({ ...g.visa, travellerCount: g.visa._count.travellers });
  if (g.fieldJobs.length > 0) throw conflict(kind === "PICKUP" ? "The collection boy is already booked for this case." : "The delivery boy is already booked for this case.");
}

/**
 * The boy, the day and the slot (Decision 2), as staff picked them: an active FIELD user; today or later, within a
 * year, a day our office is open (refused by name); a slot that's switched on (the job's own stays allowed if it was
 * switched off since) and, today, not over yet.
 */
async function checkJob(db: Db, input: ChangeFieldJobInput, keepSlotId?: number) {
  const boy = await db.user.findUnique({ where: { id: input.assigneeId }, select: { id: true, name: true, type: true, isActive: true } });
  if (!boy || boy.type !== "FIELD" || !boy.isActive) throw fieldError("assigneeId", "Pick one of the field staff.");
  const slot = await db.fieldSlot.findUnique({ where: { id: input.slotId } });
  if (!slot || (!slot.isActive && slot.id !== keepSlotId)) throw fieldError("slotId", "Pick one of the time slots.");
  const today = istToday();
  if (input.day < today) throw fieldError("day", "Pick today or a later day.");
  if (input.day > addDays(today, MAX_COLLECTION_DAYS_AHEAD)) throw fieldError("day", "Pick a day within the next year.");
  const [closed] = await blockedDays(input.day, input.day, { office: true }, db);
  if (closed) throw fieldError("day", `${closed.holidays.map((h) => h.name).join(", ")}: our office is closed that day. Pick another.`);
  if (input.day === today && istDateTimeToUtc(today, slot.endsAt) <= new Date()) {
    throw fieldError("slotId", `${slot.name} is over for today. Pick a later slot or another day.`);
  }
  return { boy, slot };
}

/** A job as the audit log shows it. */
const jobView = (j: { boy: string; day: string; slot: string; address: string; mapLink: string | null }) => j;

/**
 * "Book the collection boy" (phase 1), by whoever can act on the case at Steps 1–2, or "Book the delivery boy"
 * (phase 2), by any Visa staff with EDIT once the passports are in our stock. In one transaction under the case lock:
 * the job (with the client's mobile); for a pickup, "Send collection boy" as how the documents reach us; an open case
 * due at the slot's end; and the audit (field.job.book).
 */
export async function bookFieldJob(caseNo: string, input: BookFieldJobInput, actor: Actor) {
  const rule = RULE[input.kind];
  const enquiry = await loadCase(caseNo, actor, rule);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertCanBook(await gather(prisma, enquiry.id, input.kind), input.kind);
  await checkJob(prisma, input);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, rule);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id, input.kind);
    assertCanBook(g, input.kind);
    const { boy, slot } = await checkJob(tx, input);

    // A postponed or cancelled case keeps its due time (a delivery can be booked for one; a pickup can't).
    const dueAt = locked.status === "OPEN" ? istDateTimeToUtc(input.day, slot.endsAt) : locked.dueAt;
    if (locked.status === "OPEN") await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    // A pickup means "Send collection boy": switched, and audited like any change to it (fixed 21 Oct 2026).
    if (input.kind === "PICKUP") {
      const was = await tx.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id }, select: { arrival: true } });
      if (was.arrival !== "COLLECTION_BOY") {
        await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { arrival: "COLLECTION_BOY" } });
        await audit(
          {
            actorId: actor.user.id,
            action: "visa.case.update",
            entityType: "VisaCase",
            entityId: enquiry.id,
            clientId: enquiry.clientId,
            before: { arrival: was.arrival },
            after: { arrival: "COLLECTION_BOY", why: "collection boy booked" },
            ip: actor.ip,
          },
          tx,
        );
      }
    }
    const job = await tx.fieldJob.create({
      data: {
        departmentId: locked.departmentId,
        kind: input.kind,
        enquiryId: enquiry.id,
        assigneeId: boy.id,
        day: toDbDate(input.day),
        slotId: slot.id,
        address: input.address,
        mapLink: input.mapLink ?? null,
        mobile: g.client.mobile,
        createdById: actor.user.id,
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.book",
        entityType: "FieldJob",
        entityId: job.id,
        clientId: enquiry.clientId,
        after: { caseNo: enquiry.caseNo, kind: input.kind, ...jobView({ boy: boy.name, day: input.day, slot: slot.name, address: input.address, mapLink: input.mapLink ?? null }), dueAt },
        ip: actor.ip,
      },
      tx,
    );
    await queueFieldVisit(tx, enquiry.id, input.kind, job, { boy: boy.name, day: input.day, slot: slot.name, address: input.address });
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * Message 5, "Collection visit booked", or message 14, "Delivery booked" (docs/whatsapp-visa-messages.md): a job booked,
 * or its boy, day, slot or address changed. Keyed on the job's new updatedAt, so each change sends once; a cancel sends
 * nothing (staff call).
 */
async function queueFieldVisit(
  tx: Db,
  enquiryId: string,
  kind: FieldJobKind,
  job: { id: string; updatedAt: Date },
  visit: { boy: string; day: string; slot: string; address: string },
) {
  const template = kind === "PICKUP" ? VISA_COLLECTION_VISIT : VISA_DELIVERY_VISIT;
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template,
    enquiryId,
    key: `${template}:${job.id}:${job.updatedAt.toISOString()}`,
    clientId: basics.clientId,
    variables: { ...basics.variables, staff_name: visit.boy, visit_day: dayLabel(visit.day), visit_slot: visit.slot, address: visit.address },
  });
}

/** The case's job, by id (404 for another case's), with what it was booked for. */
async function findJob(db: Db, enquiryId: string, jobId: string) {
  const job = await db.fieldJob.findFirst({
    where: { id: jobId, enquiryId },
    include: { assignee: { select: { name: true } }, slot: { select: { name: true } } },
  });
  if (!job) throw notFound("Field job not found.");
  return job;
}

/** The job's kind decides the step it's changed at: read it before the case is loaded with that step's rule. */
async function ruleForJob(caseNo: string, jobId: string) {
  const job = await prisma.fieldJob.findFirst({ where: { id: jobId, enquiry: { caseNo: caseNo.toUpperCase() } }, select: { kind: true } });
  if (!job) throw notFound("Field job not found.");
  return RULE[job.kind];
}

function assertBooked(job: { status: string }) {
  if (job.status !== "BOOKED") throw conflict("This job isn't booked any more.");
}

/**
 * "Change" a booked job: the boy, the day, the slot, the address or the map link, checked as when booked. In one
 * transaction under the case lock: the job, the case's due time when the day or slot moved, and the audit
 * (field.job.update, with the old and new values). A save that changes nothing writes nothing.
 */
export async function changeFieldJob(caseNo: string, jobId: string, input: ChangeFieldJobInput, actor: Actor) {
  const rule = await ruleForJob(caseNo, jobId);
  const enquiry = await loadCase(caseNo, actor, rule);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await findJob(prisma, enquiry.id, jobId);
  assertBooked(pre);
  await checkJob(prisma, input, pre.slotId);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, rule);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const job = await findJob(tx, enquiry.id, jobId);
    assertBooked(job);
    const { boy, slot } = await checkJob(tx, input, job.slotId);

    const was = { assigneeId: job.assigneeId, day: fromDbDate(job.day), slotId: job.slotId, address: job.address, mapLink: job.mapLink };
    const now = { assigneeId: boy.id, day: input.day, slotId: slot.id, address: input.address, mapLink: input.mapLink ?? null };
    if (JSON.stringify(was) === JSON.stringify(now)) return;

    const updated = await tx.fieldJob.update({
      where: { id: job.id },
      data: { assigneeId: now.assigneeId, day: toDbDate(now.day), slotId: now.slotId, address: now.address, mapLink: now.mapLink },
    });
    const moved = was.day !== now.day || was.slotId !== now.slotId;
    const dueAt = moved && locked.status === "OPEN" ? istDateTimeToUtc(now.day, slot.endsAt) : locked.dueAt;
    // The due time follows the day or slot. The case's updatedAt moves with any change (a new boy, address or map link
    // too), so a dialog opened before it can't save over it (fixed 19 Oct 2026).
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt, updatedAt: new Date() } });
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.update",
        entityType: "FieldJob",
        entityId: job.id,
        clientId: enquiry.clientId,
        before: jobView({ boy: job.assignee.name, day: was.day, slot: job.slot.name, address: was.address, mapLink: was.mapLink }),
        after: { ...jobView({ boy: boy.name, day: now.day, slot: slot.name, address: now.address, mapLink: now.mapLink }), dueAt },
        ip: actor.ip,
      },
      tx,
    );
    // The client hears of a new boy, day, slot or address; a map link alone is for the boy.
    const visitMoved = was.assigneeId !== now.assigneeId || moved || was.address !== now.address;
    if (visitMoved) await queueFieldVisit(tx, enquiry.id, job.kind, updated, { boy: boy.name, day: now.day, slot: slot.name, address: now.address });
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * "Cancel" a booked job: it's called off, by whom and when (audited, field.job.cancel). The case's due time stays, so
 * it still comes back to check what happens next; another job can then be booked.
 */
export async function cancelFieldJob(caseNo: string, jobId: string, input: MatureCaseInput, actor: Actor) {
  const rule = await ruleForJob(caseNo, jobId);
  const enquiry = await loadCase(caseNo, actor, rule);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertBooked(await findJob(prisma, enquiry.id, jobId));

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, rule);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const job = await findJob(tx, enquiry.id, jobId);
    assertBooked(job);
    await tx.fieldJob.update({ where: { id: job.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.cancel",
        entityType: "FieldJob",
        entityId: job.id,
        clientId: enquiry.clientId,
        before: { status: "BOOKED", ...jobView({ boy: job.assignee.name, day: fromDbDate(job.day), slot: job.slot.name, address: job.address, mapLink: job.mapLink }) },
        after: { status: "CANCELLED" },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
