import type { SaveWarning } from '../lib/apiErrors'

/**
 * Shown when the backend answers 409 WARNING (decided 19 Oct 2026): something that's usually a mistake but can be right,
 * e.g. a visa that ends before the trip or an appointment after departure. Staff go back and check, or save anyway; the
 * confirmation is recorded in the audit log.
 */
export function WarningModal({ warnings, onCancel, onConfirm }: { warnings: SaveWarning[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="overlay overlay-center" style={{ zIndex: 30 }} onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="warn-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="warn-title">
          Check before saving
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {warnings.map((w) => (
            <li key={`${w.code}-${w.message}`}>{w.message}</li>
          ))}
        </ul>
        <p className="hint" style={{ margin: 0 }}>
          Save anyway only if it&apos;s right. The confirmation is recorded.
        </p>
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
