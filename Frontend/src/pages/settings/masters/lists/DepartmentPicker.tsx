import { canEditTagged } from '../../../../auth/permissions'
import type { User } from '../../../../auth/types'
import { RequiredMark } from '../../../../components/FormField'
import { departmentStyle, SELLING_DEPARTMENTS } from '../../../../lib/departments'
import { useTaggableDepartments } from '../departmentTags'

// The departments a follow-up or reason value shows in (docs/decisions/0018-dropdowns-by-department.md).

/** A value's departments as coloured chips; one "All departments" chip when it is in every selling department. */
export function DepartmentTags({ codes }: { codes: string[] }) {
  if (SELLING_DEPARTMENTS.every((code) => codes.includes(code))) {
    return <span className="chip chip-muted chip-sm">All departments</span>
  }
  return (
    <span className="dept-tags">
      {codes.map((code) => {
        const style = departmentStyle(code)
        return (
          <span key={code} className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
            {style.label}
          </span>
        )
      })}
    </span>
  )
}

/** Who may change a value they can't: its one department's HOD, or the Head when it is shared. */
export function TaggedEditors({ codes }: { codes: string[] }) {
  return <span className="hint">{codes.length === 1 ? `${departmentStyle(codes[0]!).label} HOD or the Head` : 'The Head'}</span>
}

/**
 * Tick boxes, one per department. A department the user isn't HOD of can't be ticked or unticked (the Head ticks any).
 * A department switched off since the value was tagged stays listed, so saving never drops it silently.
 */
export function DepartmentPicker({ me, value, onChange }: { me: User; value: string[]; onChange: (codes: string[]) => void }) {
  const departments = useTaggableDepartments()
  if (!departments.data) return <span className="hint">Loading departments…</span>

  const listed = departments.data.map((d) => ({ code: d.code, label: d.name }))
  const gone = value.filter((code) => !listed.some((d) => d.code === code)).map((code) => ({ code, label: `${departmentStyle(code).label} (switched off)` }))
  const on = new Set(value)
  const toggle = (code: string) => onChange(on.has(code) ? value.filter((c) => c !== code) : [...value, code])

  return (
    <div className="dept-picks" role="group" aria-label="Departments">
      {[...listed, ...gone].map((d) => (
        <label className="check" key={d.code}>
          <input type="checkbox" checked={on.has(d.code)} disabled={!canEditTagged(me, [d.code])} onChange={() => toggle(d.code)} />
          <span className="dot" style={{ background: departmentStyle(d.code).solid }} />
          {d.label}
        </label>
      ))}
    </div>
  )
}

/**
 * "Shows in", for the follow-up and reason drawers: the picker with its label, error and hint. Not a FormField: that
 * is a <label>, and the picker holds its own inputs.
 */
export function DepartmentsField({
  me,
  value,
  onChange,
  error,
}: {
  me: User
  value: string[]
  onChange: (codes: string[]) => void
  error: string | undefined
}) {
  return (
    <div className={`field${error ? ' field-invalid' : ''}`} style={{ gridColumn: '1 / -1' }}>
      <span>
        Shows in
        <RequiredMark />
      </span>
      <DepartmentPicker me={me} value={value} onChange={onChange} />
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        <span className="hint">Staff see it only on these departments’ cases. You can tick the ones you are HOD of.</span>
      )}
    </div>
  )
}
