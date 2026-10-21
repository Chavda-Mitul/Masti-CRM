import { departmentStyle } from '../../../lib/departments'
import { passwordLine, type PressResult } from './labels'
import { LogInForMeButton } from './LogInForMeButton'
import type { Portal } from './types'

/**
 * One portal, as on demo screen 28: its department, who may use it, the ID and password hidden, and Log in for me. The
 * Head and the department's HOD also edit or remove it, and see when its address isn't secure.
 */
export function PortalCard({
  portal,
  helperIds,
  result,
  onResult,
  onEdit,
  onRemove,
}: {
  portal: Portal
  helperIds: string[]
  /** What the last press said, kept until the next one. */
  result: PressResult | undefined
  onResult: (result: PressResult) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const style = departmentStyle(portal.department.code)
  const people = portal.users.map((u) => u.name).join(', ')
  return (
    <section className="card pad portal-card" aria-label={portal.name}>
      <div className="portal-card-top">
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {portal.department.name}
        </span>
        {people && <span className="muted small portal-people-line">{people}</span>}
      </div>
      <h2 className="h2">{portal.name}</h2>
      <p className="portal-secret">
        {portal.idLabel} •••••• · password hidden
      </p>
      <p className="small portal-status">{passwordLine(portal.passwordChangedAt)}</p>
      {portal.canEdit && portal.secureAddress === false && (
        <p className="small portal-warn">Not a secure (https) address: the portal sends the password unprotected.</p>
      )}
      {result && (
        <div className={`alert alert-${result.tone}`} role="status">
          {result.message}
        </div>
      )}
      {portal.canUse && <LogInForMeButton portal={portal} helperIds={helperIds} onResult={onResult} />}
      {portal.canEdit && (
        <div className="portal-card-actions">
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </section>
  )
}
