import type { User } from '../../../auth/types'
import { SELLING_DEPARTMENTS } from '../../../lib/departments'
import { useDepartments } from '../../../lib/useDepartments'

// The departments a follow-up or reason value shows in (docs/decisions/0018-dropdowns-by-department.md).

/** The departments a value can be for: the active ones that take enquiries (not Accounts), in menu order. */
export function useTaggableDepartments() {
  const departments = useDepartments()
  return { ...departments, data: departments.data?.filter((d) => (SELLING_DEPARTMENTS as readonly string[]).includes(d.code)) }
}

/** A new value starts in the HOD's one department; the Head and an HOD of several pick. */
export function startingDepartments(me: User): string[] {
  const own = me.type === 'HEAD' ? [] : me.departments.filter((d) => d.role === 'HOD').map((d) => d.code)
  return own.length === 1 ? own : []
}
