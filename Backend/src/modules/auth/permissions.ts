import type { Access } from "../../../generated/prisma/client";
import type { UserWithDepartments } from "../users/user";

export type DepartmentCode = "VISA" | "HOLIDAYS" | "HOTELS" | "INSURANCE" | "TICKETS" | "ACCOUNTS";

/**
 * Can this user see (VIEW) or change (EDIT) records of a department?
 * - The Head can do everything.
 * - Field staff can do nothing here: they only see the jobs assigned to them.
 * - An HOD always has EDIT in their department.
 * - Staff have the access they were given; EDIT implies VIEW.
 * Inactive users can do nothing.
 */
export function can(user: UserWithDepartments, departmentCode: string, access: Access): boolean {
  if (!user.isActive) return false;
  if (user.type === "HEAD") return true;
  if (user.type !== "OFFICE") return false;
  const membership = user.departments.find((d) => d.department.code === departmentCode && d.department.isActive);
  if (!membership) return false;
  if (membership.role === "HOD") return true;
  return access === "VIEW" || membership.access === "EDIT";
}

/** HOD of this department (or Head). Used for HOD-only powers like refund overrides and portal password resets. */
export function isHodOf(user: UserWithDepartments, departmentCode: string): boolean {
  if (!user.isActive) return false;
  if (user.type === "HEAD") return true;
  if (user.type !== "OFFICE") return false;
  return user.departments.some((d) => d.department.code === departmentCode && d.role === "HOD");
}
