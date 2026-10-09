import type { HolidayDuplicate } from '../types'

/**
 * Shown when the backend answers 409 DUPLICATE: a live holiday with the same dates already applies to one of the
 * picked targets. Usually a double entry, but two names for one day (Dussehra / Vijayadashami) are allowed.
 */
export function HolidayDuplicateModal({
  message,
  matches,
  onCancel,
  onConfirm,
}: {
  message: string
  matches: HolidayDuplicate[]
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay overlay-center" style={{ zIndex: 30 }} onClick={onCancel}>
      <div className="dialog dialog-wide" role="alertdialog" aria-modal="true" aria-labelledby="hol-dup-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="hol-dup-title">
          Already in the calendar?
        </h2>
        <p style={{ margin: 0 }}>{message}</p>
        <div className="dup-block">
          <ul className="dup-list">
            {matches.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong> · {m.label} · {m.targets.join(', ')}
                {m.status === 'PENDING' && <span className="chip chip-warn chip-sm" style={{ marginLeft: 6 }}>Waiting for review</span>}
              </li>
            ))}
          </ul>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} autoFocus>
            Go back and check
          </button>
          <button type="button" className="btn btn-dark" onClick={onConfirm}>
            Save anyway
          </button>
        </div>
      </div>
    </div>
  )
}
