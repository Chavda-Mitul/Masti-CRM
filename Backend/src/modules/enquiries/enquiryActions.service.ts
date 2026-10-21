import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { addMonths, fromDbDate, istDateTimeToUtc, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, forbidden, notFound } from "../../lib/httpError";
import { canOwnCases, isHodOf, type DepartmentCode } from "../auth/permissions";
import { blockedDays, nextOpenDay } from "../holidays/blockedDays";
import { withDepartments, type Actor, type UserWithDepartments } from "../users/user";
import { dueOnOfficeDay, getVisaSettings } from "../visa/visa.settings";
import { cancelBookedFieldJobs } from "../fieldJobs/fieldJobs.service";
import { assertNotInOpenDocket } from "../visa/visaDocket.service";
import type { CancelInput, LogFollowUpInput, PostponeInput, ReassignInput, ResumeInput } from "./enquiries.schemas";
import { assertCanActOnEnquiry, assertCanSeeEnquiry, heldAtOffice, toHandBack } from "./visibility";

// Follow-ups, postpone, cancel, resume and reassign (docs/decisions/0006-visa-documents.md Decision 6). They live on the shared
// Enquiry, so every department's cases use them. Each one sends the updatedAt the page loaded: a change by someone else
// in between is a 409 STALE. The page reloads the case afterwards, so these return only the enquiry's new state.

const include = {
  department: { select: { code: true } },
  stage: { select: { code: true } },
  visa: {
    select: {
      maturedById: true,
      bookletsCurrent: true,
      bookletsOld: true,
      docket: { select: { dispatchedAt: true } },
      handover: { select: { enquiryId: true } },
    },
  },
} satisfies Prisma.EnquiryInclude;

type LoadedEnquiry = Prisma.EnquiryGetPayload<{ include: typeof include }>;

async function load(caseNo: string, user: UserWithDepartments) {
  const enquiry = await prisma.enquiry.findUnique({ where: { caseNo: caseNo.toUpperCase() }, include });
  if (!enquiry) throw notFound("Case not found.");
  assertCanSeeEnquiry(user, enquiry);
  return enquiry;
}

/** When a postponed case comes back on the desk: the department's usual follow-up time. */
async function followUpTime(departmentCode: string) {
  return departmentCode === "VISA" ? (await getVisaSettings()).firstFollowUp.at : "11:00";
}

const state = (e: { status: string; reasonId: number | null; resumeOn: Date | null; dueAt: Date | null; ownerId: string | null }) => ({
  status: e.status,
  reasonId: e.reasonId,
  resumeOn: e.resumeOn ? fromDbDate(e.resumeOn) : null,
  dueAt: e.dueAt,
  ownerId: e.ownerId,
});

/**
 * Writes `data` only if nobody changed the enquiry since the page loaded it, and audits it in the same transaction.
 * `also` writes anything else that goes with it (the follow-up row); what it returns is added to the audit's "after".
 */
async function save(
  enquiry: LoadedEnquiry,
  sentUpdatedAt: string,
  data: Prisma.EnquiryUncheckedUpdateManyInput,
  action: string,
  actor: Actor,
  also?: (tx: Db) => Promise<Record<string, unknown>>,
) {
  assertFresh(enquiry.updatedAt, sentUpdatedAt, "case");
  const after = await prisma.$transaction(async (tx) => {
    const written = await tx.enquiry.updateMany({ where: { id: enquiry.id, updatedAt: enquiry.updatedAt }, data });
    if (written.count === 0) throw staleError("case");
    const extra = also ? await also(tx) : {};
    const row = await tx.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
    await audit(
      {
        actorId: actor.user.id,
        action,
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: state(enquiry),
        after: { ...state(row), ...extra },
        ip: actor.ip,
      },
      tx,
    );
    return row;
  });
  return { enquiry: { id: after.id, caseNo: after.caseNo, status: after.status, updatedAt: after.updatedAt } };
}

/** Only values tagged with the case's department can be picked on it (docs/decisions/0018-dropdowns-by-department.md). */
const shownIn = (departmentId: number) => ({ isActive: true, departments: { some: { departmentId } } });

async function activeReason(reasonId: number, kind: "POSTPONE" | "CANCEL", departmentId: number) {
  const reason = await prisma.enquiryReason.findFirst({ where: { id: reasonId, kind, ...shownIn(departmentId) } });
  if (!reason) {
    throw fieldError("reasonId", kind === "POSTPONE" ? "Pick a reason for postponing." : "Pick a reason for cancelling.");
  }
  return reason;
}

/**
 * "Log call": What happened → Next step → When. "When" becomes the case's due time, which drives the desk and
 * "running late". Logging a call on a postponed case resumes it (decided 10 Oct 2026). Outcomes trigger nothing else:
 * "Wants to cancel" doesn't cancel the case (Decision 7).
 */
export async function logFollowUp(caseNo: string, input: LogFollowUpInput, actor: Actor) {
  const enquiry = await load(caseNo, actor.user);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status !== "OPEN" && enquiry.status !== "POSTPONED") throw conflict("This case is closed.");

  const [outcome, nextStep] = await Promise.all([
    prisma.followUpOutcome.findFirst({ where: { id: input.outcomeId, ...shownIn(enquiry.departmentId) } }),
    prisma.followUpNextStep.findFirst({ where: { id: input.nextStepId, ...shownIn(enquiry.departmentId) } }),
  ]);
  if (!outcome) throw fieldError("outcomeId", "Pick what happened.");
  if (!nextStep) throw fieldError("nextStepId", "Pick the next step.");

  const today = istToday();
  if (input.nextOn < today) throw fieldError("nextOn", "Pick today or a later day.");
  if (input.nextOn > addMonths(today, 12)) throw fieldError("nextOn", "Pick a day within a year.");
  const nextAt = istDateTimeToUtc(input.nextOn, input.at);
  if (nextAt.getTime() <= Date.now()) throw fieldError("at", "Pick a time later than now.");
  const [closed] = await blockedDays(input.nextOn, input.nextOn, { office: true });
  if (closed) {
    throw fieldError("nextOn", `The office is closed that day (${closed.holidays.map((h) => h.name).join(", ")}). Pick another day.`);
  }

  return save(
    enquiry,
    input.updatedAt,
    { status: "OPEN", reasonId: null, resumeOn: null, dueAt: nextAt },
    "enquiry.followUp",
    actor,
    async (tx) => {
      const followUp = await tx.followUp.create({
        data: { enquiryId: enquiry.id, outcomeId: outcome.id, nextStepId: nextStep.id, nextAt, byId: actor.user.id },
      });
      return { followUp: { id: followUp.id, outcome: outcome.code, nextStep: nextStep.code, nextAt } };
    },
  );
}

/**
 * A visa case in an open docket must be taken out first (docs/decisions/0008-visa-docket-dispatch.md Decision 10).
 * Checked after save's update has locked the case's row, so an "Add to docket" can't slip in between.
 */
/**
 * Before a case is postponed or cancelled: it can't be in an open docket, and its booked field jobs are called off, so
 * the boy doesn't go (docs/decisions/0015-field-staff-app.md Defaults). What was called off goes into the audit.
 */
function onHold(enquiryId: string, actor: Actor, why: string) {
  return async (tx: Db) => {
    await assertNotInOpenDocket(tx, enquiryId);
    const jobs = await cancelBookedFieldJobs(tx, { enquiryId }, actor, why);
    return jobs.length > 0 ? { fieldJobsCancelled: jobs } : {};
  };
}

/** The client asked to wait: it comes back on the desk on the resume date (the office's next open day). */
export async function postpone(caseNo: string, input: PostponeInput, actor: Actor) {
  const enquiry = await load(caseNo, actor.user);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status !== "OPEN") throw conflict("Only an open case can be postponed.");
  await activeReason(input.reasonId, "POSTPONE", enquiry.departmentId);
  const today = istToday();
  if (input.resumeOn <= today) throw fieldError("resumeOn", "Pick a date after today.");
  if (input.resumeOn > addMonths(today, 12)) throw fieldError("resumeOn", "Pick a date within a year.");

  const dueDay = await nextOpenDay(input.resumeOn, { office: true });
  const dueAt = istDateTimeToUtc(dueDay, await followUpTime(enquiry.department.code));
  return save(
    enquiry,
    input.updatedAt,
    { status: "POSTPONED", reasonId: input.reasonId, resumeOn: toDbDate(input.resumeOn), dueAt },
    "enquiry.postpone",
    actor,
    onHold(enquiry.id, actor, "case postponed"),
  );
}

/**
 * The client dropped it. A cancelled case isn't reopened in this build, and has no due time, unless it's a visa case
 * whose passports are still to hand back: that one stays on its owner's list until the handover
 * (docs/decisions/0006-visa-documents.md amendment 15). It's due now when its file is with the vendor (to take it back)
 * or it was postponed (its due time was the resume day); otherwise it keeps the due time it had (the check after the
 * decision, the arrival day, the handover check). Passports held at our office before dispatch are due to be handed back
 * like received ones (visa.handoverCheck ⚠️). Read before the save: every custody step changes the case's updatedAt, so
 * the save's stale check refuses a cancel that one slipped in front of.
 */
export async function cancel(caseNo: string, input: CancelInput, actor: Actor) {
  const enquiry = await load(caseNo, actor.user);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status !== "OPEN" && enquiry.status !== "POSTPONED") throw conflict("This case is already closed.");
  await activeReason(input.reasonId, "CANCEL", enquiry.departmentId);
  const handBack = toHandBack(enquiry);
  const dueNow = enquiry.stage.code === "AT_VENDOR" || enquiry.status === "POSTPONED" || !enquiry.dueAt;
  const dueAt = !handBack
    ? null
    : heldAtOffice(enquiry)
      ? await dueOnOfficeDay((await getVisaSettings()).handoverCheck)
      : dueNow
        ? new Date()
        : enquiry.dueAt;
  const hold = onHold(enquiry.id, actor, "case cancelled");
  return save(
    enquiry,
    input.updatedAt,
    { status: "CANCELLED", reasonId: input.reasonId, resumeOn: null, dueAt },
    "enquiry.cancel",
    actor,
    async (tx) => ({ ...(await hold(tx)), ...(handBack ? { toHandBack: true } : {}) }),
  );
}

/** Back from a postponement, before or on its date: it is due now. */
export async function resume(caseNo: string, input: ResumeInput, actor: Actor) {
  const enquiry = await load(caseNo, actor.user);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status !== "POSTPONED") throw conflict("Only a postponed case can be resumed.");
  return save(enquiry, input.updatedAt, { status: "OPEN", reasonId: null, resumeOn: null, dueAt: new Date() }, "enquiry.resume", actor);
}

function assertCanReassign(user: UserWithDepartments, enquiry: LoadedEnquiry) {
  if (!isHodOf(user, enquiry.department.code as DepartmentCode)) {
    throw forbidden("Only the department's HOD or the Head can give a case to someone else.");
  }
}

/**
 * The HOD (or Head) gives the case to someone else: a colleague on leave, a processor after maturity, or a leaver's case
 * from "To assign". A cancelled case can be given while its passports are still to hand back (0002 amendment 1).
 */
export async function reassign(caseNo: string, input: ReassignInput, actor: Actor) {
  const enquiry = await load(caseNo, actor.user);
  assertCanReassign(actor.user, enquiry);
  if (enquiry.status === "CLOSED" || enquiry.status === "LOST" || (enquiry.status === "CANCELLED" && !toHandBack(enquiry))) {
    throw conflict("This case is closed.");
  }
  const target = await prisma.user.findUnique({ where: { id: input.ownerId }, include: withDepartments });
  if (!target || !canOwnCases(target, enquiry.department.code as DepartmentCode)) {
    throw fieldError("ownerId", "This person can't take cases of this department.");
  }
  // Whoever collected the documents can't be the one who processes the file (0006 Decision 8).
  if (enquiry.visa?.maturedById && target.id === enquiry.visa.maturedById) {
    throw fieldError("ownerId", "The person who collected the documents can't process the file. Pick someone else.");
  }
  if (target.id === enquiry.ownerId) return { enquiry: { id: enquiry.id, caseNo: enquiry.caseNo, status: enquiry.status, updatedAt: enquiry.updatedAt } };
  return save(enquiry, input.updatedAt, { ownerId: target.id }, "enquiry.reassign", actor);
}

/** Who the HOD can give this case to, by name. Not the person who matured it (they can't process it). */
export async function listAssignees(caseNo: string, user: UserWithDepartments) {
  const enquiry = await load(caseNo, user);
  assertCanReassign(user, enquiry);
  const users = await prisma.user.findMany({
    where: { isActive: true, type: { in: ["HEAD", "OFFICE"] } },
    include: withDepartments,
    orderBy: { name: "asc" },
  });
  return users
    .filter((u) => canOwnCases(u, enquiry.department.code as DepartmentCode) && u.id !== enquiry.visa?.maturedById)
    .map((u) => ({ id: u.id, name: u.name, isOwner: u.id === enquiry.ownerId }));
}
