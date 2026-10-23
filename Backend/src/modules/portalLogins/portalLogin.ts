import type { PortalPasswordSchedule, Prisma } from "../../../generated/prisma/client";
import { addDays, addMonths, istToday } from "../../lib/dates";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";

// A portal login as the API sends it, and who may do what with it (docs/decisions/0024-portal-logins.md).

/**
 * Inside a transaction, include at most one relation (Prisma 7 + adapter-pg, as notice.ts says): write plainly, then
 * reload with this after commit.
 */
export const portalLoginInclude = {
  department: { select: { code: true, name: true, isActive: true } },
  users: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.PortalLoginInclude;

export type PortalLoginRow = Prisma.PortalLoginGetPayload<{ include: typeof portalLoginInclude }>;

/** What a portal's sealed secret holds. */
export interface PortalSecret {
  loginId: string;
  password: string;
  /** A third login box's value (e.g. an agency code), for portals whose `extraLabel` is set. */
  extra?: string;
}

/** The associated data a portal's secret is sealed with: a blob copied onto another portal won't open there. */
export const secretLabel = (portalLoginId: string) => `portal-login:${portalLoginId}`;

/** The Head and the department's HOD add, change and remove its portals (only HODs reset portal passwords, rule 6). */
export function canManagePortal(user: UserWithDepartments, departmentCode: string): boolean {
  return isHodOf(user, departmentCode as DepartmentCode);
}

/**
 * Who may press "Log in for me": an active Head or office user, not on a temporary password, who is the Head, the
 * department's HOD, or on the portal's list and still in the department.
 */
export function canUsePortal(
  user: UserWithDepartments,
  portal: { department: { code: string }; users: { user: { id: string } }[] },
): boolean {
  if (!user.isActive || user.mustChangePassword) return false;
  if (user.type !== "HEAD" && user.type !== "OFFICE") return false;
  const code = portal.department.code as DepartmentCode;
  if (isHodOf(user, code)) return true;
  return portal.users.some((u) => u.user.id === user.id) && can(user, code, "VIEW");
}

/**
 * On a visa case (component 3): also whoever the case is assigned to, while they can change the department's cases. The
 * HOD decides who works on each case, so that person needn't be on the portal's list too. The Frontend's copy is in
 * src/pages/enquiries/case/ApplicationCard.tsx.
 */
export function canUsePortalOnCase(
  user: UserWithDepartments,
  portal: { department: { code: string }; users: { user: { id: string } }[] },
  enquiry: { ownerId: string | null; department: { code: string } },
): boolean {
  if (canUsePortal(user, portal)) return true;
  if (!user.isActive || user.mustChangePassword || user.type !== "OFFICE") return false;
  return enquiry.ownerId === user.id && can(user, enquiry.department.code as DepartmentCode, "EDIT");
}

/** What the password's schedule is worked out from (component 2). */
export type PasswordDates = { passwordSchedule: PortalPasswordSchedule; passwordChangedAt: Date };

/**
 * The date (India time, YYYY-MM-DD) the password has to change by: the day after the last change, 7 days after, or the
 * same date the next month (31 Jan → 28 Feb). Null with no schedule.
 */
export function passwordDueOn(portal: PasswordDates): string | null {
  const changedOn = istToday(portal.passwordChangedAt);
  switch (portal.passwordSchedule) {
    case "DAILY":
      return addDays(changedOn, 1);
    case "WEEKLY":
      return addDays(changedOn, 7);
    case "MONTHLY":
      return addMonths(changedOn, 1);
    case "NONE":
      return null;
  }
}

/**
 * From the start of the due date the portal is locked for everyone, the Head included, until an HOD types a new password
 * (demo screen 28: "the account stays locked for everyone until that's done").
 */
export function isPasswordLocked(portal: PasswordDates, now: Date = new Date()): boolean {
  const dueOn = passwordDueOn(portal);
  return dueOn !== null && istToday(now) >= dueOn;
}

/** "http://" addresses send the password unprotected; managers see a warning on the card. */
export const isSecureAddress = (loginUrl: string) => loginUrl.startsWith("https://");

/** The ID and password never leave the server here; the login address only goes to the people who manage the portal. */
export function toPortalLoginDto(row: PortalLoginRow, user: UserWithDepartments) {
  const manage = canManagePortal(user, row.department.code);
  return {
    id: row.id,
    department: { code: row.department.code, name: row.department.name },
    name: row.name,
    idLabel: row.idLabel,
    /** The third login box's name, or null for an ordinary two-box login; its value is never sent. */
    extraLabel: row.extraLabel,
    /** What to do on the portal once it's open; the helper shows it there. */
    steps: row.steps,
    status: row.status,
    users: row.users.map((u) => u.user).sort((a, b) => a.name.localeCompare(b.name)),
    passwordChangedAt: row.passwordChangedAt,
    passwordSchedule: row.passwordSchedule,
    passwordDueOn: passwordDueOn(row),
    /** Overdue: nobody can use it until an HOD types a new password. canUse still says who could. */
    locked: isPasswordLocked(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canUse: row.status === "ACTIVE" && canUsePortal(user, row),
    canEdit: manage,
    ...(manage ? { loginUrl: row.loginUrl, secureAddress: isSecureAddress(row.loginUrl) } : {}),
  };
}

/** What the audit log keeps of a portal: never its ID or password, only that they changed. */
export function portalLoginSnapshot(p: {
  departmentId: number;
  name: string;
  loginUrl: string;
  idLabel: string;
  extraLabel: string | null;
  steps: string[];
  passwordSchedule: PortalPasswordSchedule;
  status: string;
  userIds: string[];
}) {
  return {
    departmentId: p.departmentId,
    name: p.name,
    loginUrl: p.loginUrl,
    idLabel: p.idLabel,
    extraLabel: p.extraLabel,
    steps: p.steps,
    passwordSchedule: p.passwordSchedule,
    status: p.status,
    userIds: [...p.userIds].sort(),
  };
}
