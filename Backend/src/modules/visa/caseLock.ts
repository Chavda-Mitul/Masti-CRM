import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { conflict, HttpError, notFound } from "../../lib/httpError";
import { VISA_FLOW } from "../enquiries/enquiries.seed";
import { assertCanActOnEnquiry, assertCanSeeEnquiry } from "../enquiries/visibility";
import type { Actor } from "../users/user";

// Who may change a visa case, and at which step, for every Step 2, 3 and 4 write (0006 amendment 12,
// docs/decisions/0007-visa-file-prep.md Decision 1, docs/decisions/0008-visa-docket-dispatch.md Decision 3).

/** The steps a write is allowed at, and what to say at any other. */
export interface StepRule {
  stages: readonly string[];
  wrongStage: string;
}

/** Step 2: the checklist can change until maturity. After that it is the processor's to check. */
export const COLLECTING: StepRule = { stages: ["ENQUIRY", "DOCUMENTS"], wrongStage: "This case has moved past collecting documents." };

/** Step 3: the processor's checks, the file, the portal details and (in later slices) the vendor. */
export const PREPARING: StepRule = { stages: ["FILE_PREPARATION"], wrongStage: "This can only be changed during file preparation." };

/** Step 4 (docs/decisions/0008-visa-docket-dispatch.md): adding a file-ready case to a docket, or taking it out. */
export const DISPATCHING: StepRule = { stages: ["DISPATCH"], wrongStage: "This can only be changed while the case waits for dispatch." };

/** The quote (docs/decisions/0009-visa-invoice.md Decision 2): from Step 1 until the file goes to the vendor. */
export const QUOTING: StepRule = {
  stages: ["ENQUIRY", "DOCUMENTS", "FILE_PREPARATION", "DISPATCH"],
  wrongStage: "The quote can't change once the file has gone to the vendor.",
};

/** Trip details (0007 Decision 4): captured as the documents come in, and corrected during file preparation. */
export const TRIP: StepRule = {
  stages: ["ENQUIRY", "DOCUMENTS", "FILE_PREPARATION"],
  wrongStage: "Trip details can't change once the file is ready.",
};

const caseInclude = {
  department: { select: { code: true } },
  stage: true,
  visa: { select: { enquiryId: true } },
} satisfies Prisma.EnquiryInclude;

export type LockedCase = Prisma.EnquiryGetPayload<{ include: typeof caseInclude }>;

/**
 * Refuses unless this user may change the case and it is at one of the rule's steps: its owner, its HOD and the Head
 * may (only the HOD and the Head before a processor is assigned), and only while the case is open.
 */
function assertCanChange(enquiry: LockedCase, actor: Actor, rule: StepRule) {
  assertCanSeeEnquiry(actor.user, enquiry);
  assertCanActOnEnquiry(actor.user, enquiry);
  if (enquiry.status === "POSTPONED") throw conflict("This case is postponed. Resume it first.");
  if (enquiry.status !== "OPEN") throw conflict("This case is closed, so it can't change.");
  if (!rule.stages.includes(enquiry.stage.code)) throw conflict(rule.wrongStage);
}

/** The case, if this user may change it at this step: the quick check before any transaction. */
export async function loadCase(caseNo: string, actor: Actor, rule: StepRule) {
  const enquiry = await prisma.enquiry.findUnique({ where: { caseNo: caseNo.toUpperCase() }, include: caseInclude });
  if (!enquiry?.visa) throw notFound("Case not found.");
  assertCanChange(enquiry, actor, rule);
  return enquiry;
}

/**
 * The first thing every Step 2 and Step 3 write does in its transaction: lock the case's row, then read it again and
 * repeat the checks. They take the same lock, so they run one after another:
 * - a tick can't land between maturity's check that every paper is in and its move to File preparation
 * - a tick that waited behind maturity then sees the case has moved on, and is refused
 * - the same holds for a check and "File ready" in Step 3
 * Postpone, cancel and reassign update the same row, so a write waits for them too and sees their result. Ticks and
 * checks don't change the case's updatedAt, so they never make a button on someone else's open page stale.
 */
export async function lockCase(tx: Db, enquiryId: string, actor: Actor, rule: StepRule) {
  await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ${enquiryId} FOR UPDATE`;
  const enquiry = await tx.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, include: caseInclude });
  assertCanChange(enquiry, actor, rule);
  return enquiry;
}

/** One step of the visa flow, by code. */
export async function visaStage(tx: Db, departmentId: number, code: string) {
  const stage = await tx.departmentStage.findUnique({ where: { departmentId_flow_code: { departmentId, flow: VISA_FLOW, code } } });
  if (!stage) throw new HttpError(500, "The visa steps are not set up. Run the database seed.");
  return stage;
}
