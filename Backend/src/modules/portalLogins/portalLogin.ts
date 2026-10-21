import type { Prisma } from "../../../generated/prisma/client";
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
    status: row.status,
    users: row.users.map((u) => u.user).sort((a, b) => a.name.localeCompare(b.name)),
    passwordChangedAt: row.passwordChangedAt,
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
  status: string;
  userIds: string[];
}) {
  return {
    departmentId: p.departmentId,
    name: p.name,
    loginUrl: p.loginUrl,
    idLabel: p.idLabel,
    status: p.status,
    userIds: [...p.userIds].sort(),
  };
}
