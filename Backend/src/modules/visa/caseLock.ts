import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { conflict, HttpError, notFound } from "../../lib/httpError";
import { VISA_FLOW } from "../enquiries/enquiries.seed";
import { assertCanActOnEnquiry, assertCanEditDepartment, assertCanSeeEnquiry, EVISA_AFTER_SUBMISSION, passportsInStock, PRE_DISPATCH } from "../enquiries/visibility";
import type { Actor, UserWithDepartments } from "../users/user";

// Who may change a visa case, and at which step, for every Step 2, 3, 4 and 5 write (0006 amendment 12,
// docs/decisions/0007-visa-file-prep.md Decision 1, docs/decisions/0008-visa-docket-dispatch.md Decision 3,
// docs/decisions/0011-visa-at-vendor.md Decision 2).

/** The steps a write is allowed at, and what to say at any other. */
export interface StepRule {
  stages: readonly string[];
  wrongStage: string;
  /** Allowed whatever the case's status: postponed, closed or cancelled too. Who may, and at which step, still hold. */
  anyStatus?: boolean;
  /**
   * Allowed on a cancelled case too, not only an open one (a postponed one is still resumed first): the passports' way
   * back after a cancel (docs/decisions/0006-visa-documents.md amendment 15).
   */
  cancelledToo?: boolean;
  /**
   * Allowed on a closed case too, i.e. one handed over and Delivered: its invoice can still turn out wrong
   * (docs/decisions/0011-visa-at-vendor.md Decision 5).
   */
  closedToo?: boolean;
  /** Any of the department's staff with EDIT may, not only the case's owner, its HOD or the Head (0014 Decision 5). */
  anyEditor?: boolean;
}

/** Step 2: the checklist can change until maturity. After that it is the processor's to check. */
export const COLLECTING: StepRule = { stages: ["ENQUIRY", "DOCUMENTS"], wrongStage: "This case has moved past collecting documents." };

/** Step 3: the processor's checks, the file, the portal details and (in later slices) the vendor. */
export const PREPARING: StepRule = { stages: ["FILE_PREPARATION"], wrongStage: "This can only be changed during file preparation." };

/** Step 4 (docs/decisions/0008-visa-docket-dispatch.md): adding a file-ready case to a docket, or taking it out. */
export const DISPATCHING: StepRule = { stages: ["DISPATCH"], wrongStage: "This can only be changed while the case waits for dispatch." };

/** Step 5 (docs/decisions/0011-visa-at-vendor.md): the file is with the vendor, until the decision is recorded. */
export const WITH_VENDOR: StepRule = { stages: ["AT_VENDOR"], wrongStage: "This can only be changed while the file is with the vendor." };

/**
 * Step 5 (0011 Decision 6): "Take the file back" while it's with the vendor, on an open or a cancelled case, so a
 * cancelled case's passports still come back (0006 amendment 15).
 */
export const RECALLING: StepRule = { ...WITH_VENDOR, cancelledToo: true };

/** Step 6 (docs/decisions/0012-visa-decision.md): the decision is recorded from At vendor, once the file was submitted. */
export const DECIDING: StepRule = { stages: ["AT_VENDOR"], wrongStage: "The decision is recorded while the file is at At vendor." };

/**
 * Steps 6–7 (0012 Decision 6, amended 19 Oct 2026): a recorded decision is corrected while the case is at Decision or at
 * Passport back, so a sticker that doesn't match can be put right before the handover. Locked once handed over.
 */
export const DECIDED: StepRule = {
  stages: ["DECISION", "PASSPORT_BACK"],
  wrongStage: "The decision can only be changed at Decision or Passport back, before the handover.",
};

/**
 * An approved e-visa's PDF (docs/decisions/0025-evisa-after-decision.md), sent to the client when it's uploaded (change
 * request 21 part 3): at Decision, or once Delivered for a corrected one, whatever the status. Until every approved
 * e-visa has gone the case must still be open at Decision: the last one finishes it (visaEvisa.service.ts). An e-visa
 * never reaches Passport back.
 */
export const EVISA_FILES: StepRule = {
  stages: ["DECISION", "DELIVERED"],
  anyStatus: true,
  wrongStage: "The e-visa is added once the decision is recorded.",
};

/**
 * Step 7 (docs/decisions/0013-visa-passport-back.md Decision 3): "Passports on the way back", from Decision, or at
 * Passport back for a recalled file; on a cancelled case too (0006 amendment 15).
 */
export const RETURNING: StepRule = {
  stages: ["DECISION", "PASSPORT_BACK"],
  cancelledToo: true,
  wrongStage: "Passports go back after the decision, or after a recall.",
};

/** Step 7 (0013 component 2): "Change" the dates while the passports are on their way back, on a cancelled case too. */
export const IN_TRANSIT: StepRule = {
  stages: ["PASSPORT_BACK"],
  cancelledToo: true,
  wrongStage: "The dates can only be changed while the passports are on their way back.",
};

/**
 * Step 7 (0013 Decision 5): "Mark received" at Passport back, whatever the case's status: the packet is here, so it's
 * counted in (chain of custody, decided 17 Oct 2026).
 */
export const RECEIVING: StepRule = {
  stages: ["PASSPORT_BACK"],
  anyStatus: true,
  wrongStage: "Passports are received at Passport back.",
};

/**
 * Step 8 (docs/decisions/0014-visa-delivered.md Decisions 5 and 7): the handover at the office, from Passport back, by
 * any Visa staff with EDIT (whoever is at the desk), whatever the case's status. Also Steps 1–4: a cancelled case's
 * passports held at our office are handed back there (0006 amendment 15, component 3); and Steps 5–6 for an e-visa,
 * whose passports never leave our office (docs/decisions/0025-evisa-after-decision.md, part 4). The handover's own
 * checks say when (visaHandover.service.ts assertInStock).
 */
export const HANDING_OVER: StepRule = {
  stages: [...PRE_DISPATCH, ...EVISA_AFTER_SUBMISSION, "PASSPORT_BACK"],
  anyStatus: true,
  anyEditor: true,
  wrongStage: "Passports are handed over from Passport back.",
};

/** The refusal letter (0012 Decision 4): once the decision is recorded, at any later step, whatever the case's status. */
export const LETTERS: StepRule = {
  stages: ["DECISION", "PASSPORT_BACK", "DELIVERED"],
  anyStatus: true,
  wrongStage: "A refusal letter is added once the decision is recorded.",
};

/** An approved paper visa's visa copy (0012, amended 24 Oct 2026, change request 21): when a refusal letter is. */
export const VISA_COPIES: StepRule = { ...LETTERS, wrongStage: "A visa copy is added once the decision is recorded." };

/**
 * The consent form's details (docs/decisions/0022-consent-form.md): not at enquiry (Masti takes consent once the
 * business has reached that far), then alongside processing, until the passports are handed over.
 */
export const CONSENTING: StepRule = {
  stages: ["DOCUMENTS", "FILE_PREPARATION", "DISPATCH", "AT_VENDOR", "DECISION", "PASSPORT_BACK"],
  wrongStage: "Consent details are filled in from Documents until the passports are handed over.",
};

/** The quote (docs/decisions/0009-visa-invoice.md Decision 2): from Step 1 until the file goes to the vendor. */
export const QUOTING: StepRule = {
  stages: ["ENQUIRY", "DOCUMENTS", "FILE_PREPARATION", "DISPATCH"],
  wrongStage: "The quote can't change once the file has gone to the vendor.",
};

/**
 * A credit note against the case's invoice (docs/decisions/0011-visa-at-vendor.md Decision 5): an invoice can turn out
 * wrong at any step, before or after the file goes to the vendor, and after the handover too (closed, Delivered).
 */
export const INVOICED: StepRule = {
  stages: ["ENQUIRY", "DOCUMENTS", "FILE_PREPARATION", "DISPATCH", "AT_VENDOR", "DECISION", "PASSPORT_BACK", "DELIVERED"],
  wrongStage: "This case's invoice can't be changed at this step.",
  closedToo: true,
};

/**
 * "Cancel with a credit note" (0011 Decision 5): as INVOICED, and on a cancelled case too, so a client who dropped out
 * can get their money back (docs/decisions/0006-visa-documents.md amendment 15). Raising an invoice stays INVOICED.
 */
export const CREDITING: StepRule = { ...INVOICED, cancelledToo: true };

/** Trip details (0007 Decision 4): captured as the documents come in, and corrected during file preparation. */
export const TRIP: StepRule = {
  stages: ["ENQUIRY", "DOCUMENTS", "FILE_PREPARATION"],
  wrongStage: "Trip details can't change once the file is ready.",
};

/**
 * How urgent the case is (docs/decisions/0003-visa-intake.md amendment 1): at any step while the case is open. A
 * delivered case is closed, so the status check refuses it first.
 */
export const URGENCY: StepRule = {
  stages: ["ENQUIRY", "DOCUMENTS", "FILE_PREPARATION", "DISPATCH", "AT_VENDOR", "DECISION", "PASSPORT_BACK", "DELIVERED"],
  wrongStage: "How urgent the case is can't change at this step.",
};

const caseInclude = {
  department: { select: { code: true } },
  stage: true,
  visa: {
    select: {
      enquiryId: true,
      passportsReceivedAt: true,
      bookletsCurrent: true,
      bookletsOld: true,
      submittedOnlineAt: true,
      evisaSentAt: true,
      handover: { select: { enquiryId: true } },
      // An e-visa where everyone was refused has nothing to send: its passports go back (0025, part 5).
      travellers: { select: { outcome: true } },
    },
  },
} satisfies Prisma.EnquiryInclude;

export type LockedCase = Prisma.EnquiryGetPayload<{ include: typeof caseInclude }>;

/**
 * Refuses unless this user may change the case and it is at one of the rule's steps: its owner, its HOD and the Head
 * may (only the HOD and the Head before a processor is assigned), or any of the department's staff with EDIT when
 * the rule says so; and only while the case is open (or cancelled, or closed, when the rule says so; or any status,
 * when the rule allows it).
 */
function assertCanChange(enquiry: LockedCase, actor: Actor, rule: StepRule) {
  assertCanSeeEnquiry(actor.user, { ...enquiry, inStock: passportsInStock(enquiry) });
  if (rule.anyEditor) assertCanEditDepartment(actor.user, enquiry);
  else assertCanActOnEnquiry(actor.user, enquiry);
  if (!rule.anyStatus) {
    if (enquiry.status === "POSTPONED") throw conflict("This case is postponed. Resume it first.");
    const allowed =
      enquiry.status === "OPEN" ||
      (rule.cancelledToo === true && enquiry.status === "CANCELLED") ||
      (rule.closedToo === true && enquiry.status === "CLOSED");
    if (!allowed) throw conflict("This case is closed, so it can't change.");
  }
  if (!rule.stages.includes(enquiry.stage.code)) throw conflict(rule.wrongStage);
}

/**
 * The case's id, its client's and its docket's, if this user may open it: staff their own, the HOD the department's, the Head all
 * (0006 Decision 1). For reads and checks that anyone who can open the case may make.
 */
export async function findVisibleCase(caseNo: string, user: UserWithDepartments) {
  const row = await prisma.enquiry.findUnique({
    where: { caseNo: caseNo.toUpperCase() },
    select: {
      id: true,
      clientId: true,
      ownerId: true,
      status: true,
      department: { select: { code: true } },
      stage: { select: { code: true } },
      visa: {
        select: {
          docketId: true,
          passportsReceivedAt: true,
          bookletsCurrent: true,
          bookletsOld: true,
          submittedOnlineAt: true,
          evisaSentAt: true,
          handover: { select: { enquiryId: true } },
          travellers: { select: { outcome: true } },
        },
      },
    },
  });
  if (!row?.visa) throw notFound("Case not found.");
  assertCanSeeEnquiry(user, { ...row, inStock: passportsInStock(row) });
  return { id: row.id, clientId: row.clientId, docketId: row.visa.docketId };
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
