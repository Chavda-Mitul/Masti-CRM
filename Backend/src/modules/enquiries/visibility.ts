import type { Prisma } from "../../../generated/prisma/client";
import { forbidden } from "../../lib/httpError";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";

// Who sees an enquiry (docs/decisions/0006-visa-documents.md Decision 1, amended 10 Oct 2026):
// - staff with EDIT see only the enquiries they own
// - view-only users see every enquiry of the department, read-only (e.g. Accounts handling fees and invoices)
// - the HOD sees every enquiry of their department
// - the Head sees everything
// - Visa staff with EDIT also see a case whose passports are in our stock, to hand them over at the desk
//   (docs/decisions/0014-visa-delivered.md Decision 5); only the handover is theirs
// Changing an enquiry stays with its owner, its HOD or the Head (assertCanActOnEnquiry).
// The list, the case page and the client profile all go through here, so they can't disagree. The one exception is the
// New enquiry lookup, which shows colleagues' open cases so nobody opens a duplicate.

/** Sees every enquiry of this department, not just their own: its HOD or the Head, or a view-only user. */
export const seesWholeDepartment = (user: UserWithDepartments, code: string) =>
  isHodOf(user, code as DepartmentCode) || !can(user, code as DepartmentCode, "EDIT");

/** A visa case whose passports are in our stock: received at Step 7 and not yet handed over (0014 Decision 5). */
const IN_STOCK: Prisma.EnquiryWhereInput = {
  stage: { code: "PASSPORT_BACK" },
  visa: { passportsReceivedAt: { not: null }, handover: { is: null } },
};

/** Whether a loaded case's passports are in our stock, as IN_STOCK says. */
export function passportsInStock(e: { stage: { code: string }; visa: { passportsReceivedAt: Date | null; handover: unknown } | null }) {
  return e.stage.code === "PASSPORT_BACK" && !!e.visa?.passportsReceivedAt && !e.visa.handover;
}

/**
 * A visa case whose passports are still to hand back to the client: its file went to the vendor in a dispatched docket
 * and nothing is handed over yet (with the vendor, on the way back or in our stock). A cancelled one stays on its
 * owner's Open list until then (docs/decisions/0006-visa-documents.md amendment 15). An e-visa never is.
 */
export const TO_HAND_BACK: Prisma.EnquiryWhereInput = {
  visa: { docket: { is: { dispatchedAt: { not: null } } }, handover: { is: null } },
};

/** Whether a loaded visa case's passports are still to hand back, as TO_HAND_BACK says. */
export function toHandBack(visa: { docket: { dispatchedAt: Date | null } | null; handover: unknown } | null) {
  return !!visa?.docket?.dispatchedAt && !visa.handover;
}

/**
 * The enquiries this user may see, among `departments` (the ones they can VIEW). An unowned enquiry (e.g. matured,
 * waiting for a processor) is seen by the HOD, the Head and view-only users, not by other staff.
 */
export function visibleEnquiryWhere(user: UserWithDepartments, departments: { id: number; code: string }[]): Prisma.EnquiryWhereInput {
  const whole = departments.filter((d) => seesWholeDepartment(user, d.code)).map((d) => d.id);
  const ownOnly = departments.filter((d) => !seesWholeDepartment(user, d.code)).map((d) => d.id);
  const or: Prisma.EnquiryWhereInput[] = [];
  if (whole.length > 0) or.push({ departmentId: { in: whole } });
  if (ownOnly.length > 0) or.push({ departmentId: { in: ownOnly }, ownerId: user.id });
  // Visa staff also see the cases whose passports are in our stock, to hand them over (0014 Decision 5).
  const visaOwnOnly = departments.filter((d) => d.code === "VISA" && !seesWholeDepartment(user, d.code)).map((d) => d.id);
  if (visaOwnOnly.length > 0) or.push({ departmentId: { in: visaOwnOnly }, ...IN_STOCK });
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

/** May this user open this enquiry? `inStock`: a visa case whose passports are in our stock (passportsInStock). */
export function canSeeEnquiry(
  user: UserWithDepartments,
  enquiry: { department: { code: string }; ownerId: string | null; inStock?: boolean },
): boolean {
  const code = enquiry.department.code as DepartmentCode;
  if (!can(user, code, "VIEW")) return false;
  if (seesWholeDepartment(user, code) || (enquiry.ownerId !== null && enquiry.ownerId === user.id)) return true;
  return code === "VISA" && enquiry.inStock === true;
}

/**
 * May this user change this enquiry (tick documents, log follow-ups…)? Department EDIT, and its owner, its HOD or the Head.
 * View-only staff can't act; neither can a colleague who doesn't own it.
 */
export function assertCanActOnEnquiry(user: UserWithDepartments, enquiry: { department: { code: string }; ownerId: string | null }) {
  const code = enquiry.department.code as DepartmentCode;
  const owns = enquiry.ownerId !== null && enquiry.ownerId === user.id;
  if (!can(user, code, "EDIT") || !(isHodOf(user, code) || owns)) {
    throw forbidden("Only the person this case is assigned to, the department's HOD and the Head can change it.");
  }
}

/** May this user do what any of the department's staff with EDIT may (the handover at the desk, 0014 Decision 5)? */
export function assertCanEditDepartment(user: UserWithDepartments, enquiry: { department: { code: string } }) {
  if (!can(user, enquiry.department.code as DepartmentCode, "EDIT")) throw forbidden("Only the department's staff who can edit can do this.");
}

export function assertCanSeeEnquiry(
  user: UserWithDepartments,
  enquiry: { department: { code: string }; ownerId: string | null; inStock?: boolean },
) {
  if (!canSeeEnquiry(user, enquiry)) throw forbidden("This case is someone else's. Only its owner, the department's HOD and the Head can open it.");
}
