import { Link } from 'react-router'
import { formatMobile } from '../../lib/format'
import type { Duplicate } from './types'

const FIELD_LABEL: Record<Duplicate['field'], string> = {
  mobile: 'Mobile number',
  pan: 'PAN',
  gstin: 'GSTIN',
  passportNumber: 'Passport number',
}

/**
 * Shown when the backend answers 409 DUPLICATE. A match is often a double entry, but not always
 * (one person in two families, an accountant's number on two companies), so staff can still save.
 * Links open in a new tab so the form being filled in isn't lost.
 */
export function DuplicateWarningModal({
  message,
  duplicates,
  onCancel,
  onConfirm,
}: {
  message: string
  duplicates: Duplicate[]
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay overlay-center" style={{ zIndex: 30 }} onClick={onCancel}>
      <div className="dialog dialog-wide" role="alertdialog" aria-modal="true" aria-labelledby="dup-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="dup-title">
          Already on file
        </h2>
        <p style={{ margin: 0 }}>{message}</p>

        {duplicates.map((d) => (
          <div key={d.field} className="dup-block">
            <div className="lbl">
              {FIELD_LABEL[d.field]} <span className="mono">{d.field === 'mobile' ? formatMobile(d.value) : d.value}</span>
            </div>
            <ul className="dup-list">
              {d.matches.map((m) => (
                <li key={`${m.clientId}-${m.memberId ?? ''}`}>
                  {m.memberName && <strong>{m.memberName}</strong>}
                  {m.memberName && <span className="muted"> in </span>}
                  <Link to={`/clients/${m.clientId}`} target="_blank" rel="noreferrer">
                    {m.clientName ?? 'Unnamed client'}
                  </Link>
                  <span className="muted mono" style={{ fontSize: 12.5 }}>
                    {' '}
                    · {formatMobile(m.clientMobile)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <p className="hint" style={{ margin: 0 }}>
          If it&apos;s the same person or company, use the existing record instead. Save anyway only if they really are different.
          The confirmation is recorded.
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
