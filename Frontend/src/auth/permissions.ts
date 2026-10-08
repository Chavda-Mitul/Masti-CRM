import type { Access, User } from './types'

// Mirrors Backend/src/modules/auth/permissions.ts and Backend/src/modules/clients/access.ts.
// These only decide what the screens offer; the backend enforces the same rules on every request.

/** Can this user see (VIEW) or change (EDIT) records of a department? The Head can do everything. */
export function can(user: User, departmentCode: string, access: Access): boolean {
  if (!user.isActive) return false
  if (user.type === 'HEAD') return true
  if (user.type !== 'OFFICE') return false
  const membership = user.departments.find((d) => d.code === departmentCode)
  if (!membership) return false
  if (membership.role === 'HOD') return true
  return access === 'VIEW' || membership.access === 'EDIT'
}

/** Clients are shared by every department: EDIT in any of them (or being Head) lets you change them. */
export function canEditClients(user: User): boolean {
  if (user.type === 'HEAD') return user.isActive
  return user.departments.some((d) => can(user, d.code, 'EDIT'))
}

/** Accounting code, billing cycle and payment habit belong to Accounts (and the Head). */
export function canEditAccountsFields(user: User): boolean {
  return can(user, 'ACCOUNTS', 'EDIT')
}
