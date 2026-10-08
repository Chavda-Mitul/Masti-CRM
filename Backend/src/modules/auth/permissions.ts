import type { Access } from "../../../generated/prisma/client";
import type { UserWithDepartments } from "../users/user";

export type DepartmentCode = "VISA" | "HOLIDAYS" | "HOTELS" | "INSURANCE" | "TICKETS" | "ACCOUNTS";

type Membership = UserWithDepartments["departments"][number];

/** What one department membership allows. A switched-off department allows nothing. */
function grants(membership: Membership, access: Access): boolean {
  if (!membership.department.isActive) return false;
  if (membership.role === "HOD") return true;
  return access === "VIEW" || membership.access === "EDIT";
}

/**
 * Can this user see (VIEW) or change (EDIT) records of a department?
 * - The Head can do everything.
 * - Field staff can do nothing here: they only see the jobs assigned to them.
 * - An HOD always has EDIT in their department.
 * - Staff have the access they were given; EDIT implies VIEW.
 * Inactive users and inactive departments allow nothing.
 */
export function can(user: UserWithDepartments, departmentCode: DepartmentCode, access: Access): boolean {
  if (!user.isActive) return false;
  if (user.type === "HEAD") return true;
  if (user.type !== "OFFICE") return false;
  const membership = user.departments.find((d) => d.department.code === departmentCode);
  return membership ? grants(membership, access) : false;
}

/** EDIT in at least one active department (or Head). */
export function canEditAnyDepartment(user: UserWithDepartments): boolean {
  if (!user.isActive) return false;
  if (user.type === "HEAD") return true;
  if (user.type !== "OFFICE") return false;
  return user.departments.some((d) => grants(d, "EDIT"));
}

/** HOD of this (active) department, or Head. Used for HOD-only powers like refund overrides and portal password resets. */
export function isHodOf(user: UserWithDepartments, departmentCode: DepartmentCode): boolean {
  if (!user.isActive) return false;
  if (user.type === "HEAD") return true;
  if (user.type !== "OFFICE") return false;
  return user.departments.some((d) => d.department.code === departmentCode && d.department.isActive && d.role === "HOD");
}

/** HOD of at least one active department, or Head. Masters shared by every department (the holiday calendar) use it. */
export function isHodOfAny(user: UserWithDepartments): boolean {
  if (!user.isActive) return false;
  if (user.type === "HEAD") return true;
  if (user.type !== "OFFICE") return false;
  return user.departments.some((d) => d.department.isActive && d.role === "HOD");
}
