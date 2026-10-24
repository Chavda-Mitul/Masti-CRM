import { useState } from 'react'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { useRecordDecision } from '../queries'
import type { VisaCase } from '../types'
import { DecisionRow } from './DecisionRow'
import { emptyRow, numberWords, rowProblem, type DecisionRowValue } from './decisionValues'

/**
 * "Record the decision" (docs/decisions/0012-visa-decision.md Decision 6): one form for the whole family once the file
 * was submitted. Each traveller is Approved or Refused (demo screen 11), with nothing typed (amended 23 Oct 2026, change
 * request 21): an approved one's sticker number (an e-visa's number) and dates are added later with Change on the
 * Decision card. Saving moves the case to Step 6 · Decision.
 */
export function DecisionDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const record = useRecordDecision(c.caseNo)
  // An e-visa where everyone is refused and we hold no passports closes the case (0025, part 5): check, then save.
  const guard = useWarningGuard()
  const [rows, setRows] = useState<Record<string, DecisionRowValue>>(() => Object.fromEntries(c.travellers.map((t) => [t.id, emptyRow])))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const setRow = (id: string, patch: Partial<DecisionRowValue>) => {
    setRows({ ...rows, [id]: { ...rows[id]!, ...patch } })
    // The row's message goes once it's touched; Save checks it again.
    if (errors[id]) setErrors(Object.fromEntries(Object.entries(errors).filter(([key]) => key !== id)))
  }

  const press = () => {
    const missing: Record<string, string> = {}
    for (const t of c.travellers) {
      const problem = rowProblem(rows[t.id]!)
      if (problem) missing[t.id] = problem
    }
    setErrors(missing)
    if (Object.keys(missing).length) return
    const outcomes = c.travellers.map((t) => ({ travellerId: t.id, outcome: rows[t.id]!.outcome! }))
    const send = (confirmWarnings: boolean) =>
      record.mutate(
        { outcomes, updatedAt: c.updatedAt, ...(confirmWarnings ? { confirmWarnings } : {}) },
        {
          onSuccess: (saved) => {
            const approved = outcomes.filter((o) => o.outcome === 'APPROVED').length
            // An e-visa with everyone refused and no passports held has nothing left to do (0025, part 5).
            const closed = saved.status === 'CLOSED' ? ' The case is closed.' : ''
            toast({ tone: 'ok', message: `Decision recorded: ${approved} approved, ${outcomes.length - approved} refused.${closed}` })
            onClose()
          },
          onError: (err) => {
            guard.intercept(err, () => send(true))
          },
        },
      )
    send(false)
  }
  const issue = errorBody(record.error)?.issues?.outcomes?.[0]
  const message = issue ?? errorText(record.error)

  return (
    <>
      <div className="overlay overlay-center" onClick={onClose}>
        <div className="dialog decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title" onClick={(e) => e.stopPropagation()}>
          <h2 className="h2" id="decision-title">
            Record the decision
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Approved or Refused, per traveller. Saving moves the case to Decision. The {numberWords(!!c.submittedOnline)} and dates can be added
            later on the Decision card.
          </p>

          {c.travellers.map((t) => (
            <DecisionRow
              key={t.id}
              name={t.name ?? t.label}
              row={rows[t.id]!}
              online={!!c.submittedOnline}
              details={false}
              disabled={record.isPending}
              error={errors[t.id]}
              onChange={(patch) => setRow(t.id, patch)}
            />
          ))}

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
      {guard.modal}
    </>
  )
}
