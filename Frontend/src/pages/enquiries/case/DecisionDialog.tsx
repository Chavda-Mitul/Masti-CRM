import { useState } from 'react'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useRecordDecision } from '../queries'
import type { VisaCase, VisaOutcome } from '../types'

interface Row {
  outcome: VisaOutcome | null
  visaNo: string
  validFrom: string
  validTo: string
}

/**
 * "Record the decision" (docs/decisions/0012-visa-decision.md Decision 6): one form for the whole family once the file
 * was submitted. Each traveller is Approved or Refused (demo screen 11); an approved one needs the sticker number (an
 * e-visa's number) and the dates it's valid (Decision 3). Saving moves the case to Step 6 · Decision.
 */
export function DecisionDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const record = useRecordDecision(c.caseNo)
  const number = c.submittedOnline ? 'e-Visa no.' : 'Sticker no.'
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(c.travellers.map((t) => [t.id, { outcome: null, visaNo: '', validFrom: '', validTo: '' }])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const setRow = (id: string, patch: Partial<Row>) => {
    setRows({ ...rows, [id]: { ...rows[id]!, ...patch } })
    // The row's message goes once it's touched; Save checks it again.
    if (errors[id]) setErrors(Object.fromEntries(Object.entries(errors).filter(([key]) => key !== id)))
  }

  const press = () => {
    const missing: Record<string, string> = {}
    for (const t of c.travellers) {
      const r = rows[t.id]!
      if (!r.outcome) missing[t.id] = 'Pick Approved or Refused.'
      else if (r.outcome === 'APPROVED' && !r.visaNo.trim()) missing[t.id] = `Enter the ${number.replace(' no.', ' number').toLowerCase()}.`
      else if (r.outcome === 'APPROVED' && (!r.validFrom || !r.validTo)) missing[t.id] = 'Enter both dates.'
      else if (r.outcome === 'APPROVED' && r.validTo < r.validFrom) missing[t.id] = 'It can’t end before it starts.'
    }
    setErrors(missing)
    if (Object.keys(missing).length) return
    const outcomes = c.travellers.map((t) => {
      const r = rows[t.id]!
      return r.outcome === 'APPROVED'
        ? { travellerId: t.id, outcome: r.outcome, visaNo: r.visaNo, validFrom: r.validFrom, validTo: r.validTo }
        : { travellerId: t.id, outcome: r.outcome! }
    })
    record.mutate(
      { outcomes, updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          const approved = outcomes.filter((o) => o.outcome === 'APPROVED').length
          toast({ tone: 'ok', message: `Decision recorded: ${approved} approved, ${outcomes.length - approved} refused.` })
          onClose()
        },
      },
    )
  }
  const issue = errorBody(record.error)?.issues?.outcomes?.[0]
  const message = issue ?? errorText(record.error)

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="decision-title">
          Record the decision
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Two outcomes, per traveller. An approved visa needs its {number.replace(' no.', ' number').toLowerCase()} and the dates it’s valid.
          Saving moves the case to Decision.
        </p>

        {c.travellers.map((t) => {
          const r = rows[t.id]!
          return (
            <div key={t.id} className="decision-row">
              <strong>{t.name ?? t.label}</strong>
              <span className="seg-btn" role="radiogroup" aria-label={`${t.name ?? t.label}: decision`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={r.outcome === 'APPROVED'}
                  className={r.outcome === 'APPROVED' ? 'on ok' : ''}
                  disabled={record.isPending}
                  onClick={() => setRow(t.id, { outcome: 'APPROVED' })}
                >
                  Approved
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={r.outcome === 'REFUSED'}
                  className={r.outcome === 'REFUSED' ? 'on bad' : ''}
                  disabled={record.isPending}
                  onClick={() => setRow(t.id, { outcome: 'REFUSED' })}
                >
                  Refused
                </button>
              </span>
              {r.outcome === 'APPROVED' && (
                <div className="decision-details">
                  <label className="field">
                    <span className="lbl">{number}</span>
                    <input
                      className="input mono upper"
                      value={r.visaNo}
                      onChange={(e) => setRow(t.id, { visaNo: e.target.value })}
                      disabled={record.isPending}
                      placeholder={c.submittedOnline ? 'EV-2026/88213' : '0182 4471'}
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span className="lbl">Valid from</span>
                    <input
                      className="input"
                      type="date"
                      value={r.validFrom}
                      onChange={(e) => setRow(t.id, { validFrom: e.target.value })}
                      disabled={record.isPending}
                    />
                  </label>
                  <label className="field">
                    <span className="lbl">Valid to</span>
                    <input
                      className="input"
                      type="date"
                      value={r.validTo}
                      min={r.validFrom || undefined}
                      onChange={(e) => setRow(t.id, { validTo: e.target.value })}
                      disabled={record.isPending}
                    />
                  </label>
                </div>
              )}
              {errors[t.id] && <span className="field-error decision-error">{errors[t.id]}</span>}
            </div>
          )
        })}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={record.isPending} onClick={press}>
            {record.isPending ? 'Saving…' : 'Save the decision'}
          </button>
        </div>
      </div>
    </div>
  )
}
