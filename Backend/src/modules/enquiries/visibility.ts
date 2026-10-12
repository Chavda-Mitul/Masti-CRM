import type { Prisma } from "../../../generated/prisma/client";
import { forbidden } from "../../lib/httpError";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";

// Who sees an enquiry (docs/decisions/0006-visa-documents.md Decision 1, amended 10 Oct 2026):
// - staff with EDIT see only the enquiries they own
// - view-only users see every enquiry of the department, read-only (e.g. Accounts handling fees and invoices)
// - the HOD sees every enquiry of their department
// - the Head sees everything
// Changing an enquiry stays with its owner, its HOD or the Head (assertCanActOnEnquiry).
// The list, the case page and the client profile all go through here, so they can't disagree. The one exception is the
// New enquiry lookup, which shows colleagues' open cases so nobody opens a duplicate.

/** Sees every enquiry of this department, not just their own: its HOD or the Head, or a view-only user. */
export const seesWholeDepartment = (user: UserWithDepartments, code: string) =>
  isHodOf(user, code as DepartmentCode) || !can(user, code as DepartmentCode, "EDIT");

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
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

/** May this user open this enquiry? */
export function canSeeEnquiry(user: UserWithDepartments, enquiry: { department: { code: string }; ownerId: string | null }): boolean {
  const code = enquiry.department.code as DepartmentCode;
  if (!can(user, code, "VIEW")) return false;
  return seesWholeDepartment(user, code) || (enquiry.ownerId !== null && enquiry.ownerId === user.id);
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

export function assertCanSeeEnquiry(user: UserWithDepartments, enquiry: { department: { code: string }; ownerId: string | null }) {
  if (!canSeeEnquiry(user, enquiry)) throw forbidden("This case is someone else's. Only its owner, the department's HOD and the Head can open it.");
}
