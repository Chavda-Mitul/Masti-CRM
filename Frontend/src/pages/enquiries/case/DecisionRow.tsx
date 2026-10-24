import { numberLabel, type DecisionRowValue } from './decisionValues'

/**
 * One traveller in "Record the decision" and "Change the decision" (Decisions 3 and 6): the demo's Approved / Refused
 * toggle (green / red, screen 11). Recording stops there (amended 23 Oct 2026, change request 21); Change also takes an
 * approved one's sticker (or e-visa) number and the dates it's valid, each optional.
 */
export function DecisionRow({
  name,
  row: r,
  online,
  details,
  disabled,
  error,
  onChange,
}: {
  name: string
  row: DecisionRowValue
  /** An e-visa (Submitted online): its e-visa number in place of a sticker. */
  online: boolean
  /** Change: an approved one's number and dates, optional. Recording has none. */
  details: boolean
  disabled: boolean
  error: string | undefined
  onChange: (patch: Partial<DecisionRowValue>) => void
}) {
  return (
    <div className="decision-row">
      <strong>{name}</strong>
      <span className="seg-btn" role="radiogroup" aria-label={`${name}: decision`}>
        <button
          type="button"
          role="radio"
          aria-checked={r.outcome === 'APPROVED'}
          className={r.outcome === 'APPROVED' ? 'on ok' : ''}
          disabled={disabled}
          onClick={() => onChange({ outcome: 'APPROVED' })}
        >
          Approved
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={r.outcome === 'REFUSED'}
          className={r.outcome === 'REFUSED' ? 'on bad' : ''}
          disabled={disabled}
          onClick={() => onChange({ outcome: 'REFUSED' })}
        >
          Refused
        </button>
      </span>
      {details && r.outcome === 'APPROVED' && (
        <div className="decision-details">
          <label className="field">
            <span className="lbl">{numberLabel(online)} (optional)</span>
            <input
              className="input mono upper"
              value={r.visaNo}
              onChange={(e) => onChange({ visaNo: e.target.value })}
              disabled={disabled}
              placeholder={online ? 'EV-2026/88213' : '0182 4471'}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="lbl">Valid from (optional)</span>
            <input
              className="input"
              type="date"
              value={r.validFrom}
              onChange={(e) => onChange({ validFrom: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span className="lbl">Valid to (optional)</span>
            <input
              className="input"
              type="date"
              value={r.validTo}
              min={r.validFrom || undefined}
              onChange={(e) => onChange({ validTo: e.target.value })}
              disabled={disabled}
            />
          </label>
        </div>
      )}
      {error && <span className="field-error decision-error">{error}</span>}
    </div>
  )
}
