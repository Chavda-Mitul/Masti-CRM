import type { Access, User } from './types'

// Mirrors Backend/src/modules/auth/permissions.ts, Backend/src/modules/clients/access.ts and visaMasters/access.ts.
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

/** HOD of this department, or the Head. Mirrors isHodOf in the backend. */
export function isHodOf(user: User, departmentCode: string): boolean {
  if (!user.isActive) return false
  if (user.type === 'HEAD') return true
  return user.type === 'OFFICE' && user.departments.some((d) => d.code === departmentCode && d.role === 'HOD')
}

/**
 * May this user open this enquiry? Staff with EDIT open their own, the HOD the department's, the Head all (0006 Decision 1).
 * View-only users see the whole department, read-only (amended 10 Oct 2026).
 * Mirrors canSeeEnquiry in Backend/src/modules/enquiries/visibility.ts.
 */
export function canSeeEnquiry(user: User, enquiry: { department: string; owner: { id: string } | null }): boolean {
  if (!can(user, enquiry.department, 'VIEW')) return false
  if (isHodOf(user, enquiry.department) || !can(user, enquiry.department, 'EDIT')) return true
  return enquiry.owner?.id === user.id
}

/**
 * May this user change this enquiry (name travellers, tick documents…)? EDIT, and its owner, its HOD or the Head.
 * Mirrors assertCanActOnEnquiry in Backend/src/modules/enquiries/visibility.ts.
 */
export function canActOnCase(user: User, enquiry: { department: string; owner: { id: string } | null }): boolean {
  if (!can(user, enquiry.department, 'EDIT')) return false
  return isHodOf(user, enquiry.department) || enquiry.owner?.id === user.id
}

/** HOD of any department, or the Head. Mirrors isHodOfAny in the backend. */
export function isHodOfAny(user: User): boolean {
  if (!user.isActive) return false
  if (user.type === 'HEAD') return true
  return user.type === 'OFFICE' && user.departments.some((d) => d.role === 'HOD')
}

// System masters (docs/decisions/0005-system-masters.md §8). "Only Vimal and HODs can change them" ⚠️.

/** Countries, visa types, documents, offerings and checklists: the Head or the Visa HOD. */
export const canEditVisaMasters = (user: User) => isHodOf(user, 'VISA')
/** The holiday calendar is shared by every department: the Head or any HOD. */
export const canEditHolidays = (user: User) => isHodOfAny(user)
/** Embassies are holiday targets for every department: the Head or any HOD. */
export const canEditEmbassies = (user: User) => isHodOfAny(user)
/** Follow-up outcomes, next steps and postpone/cancel reasons are shared by every department: the Head or any HOD (0006). */
export const canEditEnquiryMasters = (user: User) => isHodOfAny(user)
/** The visa masters are readable with Visa VIEW (the Head always). */
export const canViewVisaMasters = (user: User) => can(user, 'VISA', 'VIEW')
