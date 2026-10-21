import { useState } from 'react'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { istToday } from '../../../lib/format'
import { formatRupees } from '../../../lib/money'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useCancelCase, usePostponeCase } from '../queries'
import type { VisaCase } from '../types'
import { firstName, heldAtOffice, liveInvoice, toHandBack } from './labels'

type HoldKind = 'POSTPONE' | 'CANCEL'

/** Where the passports are now: "in our office" (before dispatch), "with the vendor", "on their way back" or "in our stock". */
function passportsWhere(c: VisaCase) {
  if (heldAtOffice(c)) return 'in our office'
  if (c.passportsReceived) return 'in our stock'
  if (c.passportsBack) return 'on their way back'
  return 'with the vendor'
}

/**
 * What cancelling leaves of each invoice that still stands (0006 amendment 15). With the file at the vendor, what goes
 * back is set when it's taken back (a whole credit note is refused after the recall's part one); otherwise the Visa HOD
 * can cancel it with a credit note once the case is cancelled, and a charge Masti keeps is billed before cancelling.
 * Nothing for an invoice a recall already gave part of.
 */
function invoiceNotes(c: VisaCase): { notes: string[]; billFirst: boolean } {
  const notes: string[] = []
  let billFirst = false
  const main = liveInvoice(c)
  if (main && main.partCredits.length === 0) {
    const atVendor = c.stage.code === 'AT_VENDOR' && toHandBack(c) && !c.recall
    const what = `Invoice ${main.invoiceNo} (${formatRupees(main.totalPaise)})`
    if (atVendor) notes.push(`${what} stands: what goes back is set when you take the file back.`)
    else {
      notes.push(`${what} still stands. If the client shouldn’t pay it, the Visa HOD can cancel it with a credit note after you cancel.`)
      billFirst = true
    }
  }
  const extra = c.additionalInvoice
  if (extra && !extra.cancelled) {
    notes.push(`Additional invoice ${extra.invoiceNo} (${formatRupees(extra.totalPaise)}) still stands. The Visa HOD can cancel it with a credit note after you cancel.`)
    billFirst = true
  }
  return { notes, billFirst }
}

/** "YYYY-MM-DD" one day after `date`. */
function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Postpone (a reason and when it comes back) or cancel (a reason) a case (0006 Decision 6). Reasons are fixed lists
 * from Settings → Masters: "Fixed reasons only — no free text anywhere."
 */
export function PostponeCancelDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const reasons = useMasterList('enquiry-reasons')
  const postpone = usePostponeCase(c.caseNo)
  const cancel = useCancelCase(c.caseNo)
  const [kind, setKind] = useState<HoldKind>('POSTPONE')
  const [reasonId, setReasonId] = useState('')
  const [resumeOn, setResumeOn] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Only the reasons tagged with the case's department (0018).
  const options = (reasons.data ?? []).filter((r) => r.isActive && r.kind === kind && r.departments.includes(c.department.code))
  const action = kind === 'POSTPONE' ? postpone : cancel
  const minDate = nextDay(istToday())
  const money = invoiceNotes(c)

  /** The backend's per-field messages (400 issues), next to the matching inputs. */
  const onError = (err: unknown) => {
    const issues = errorBody(err)?.issues ?? {}
    setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
  }

  const submit = () => {
    const missing: Record<string, string> = {}
    if (!reasonId) missing.reasonId = kind === 'POSTPONE' ? 'Pick a reason for postponing.' : 'Pick a reason for cancelling.'
    if (kind === 'POSTPONE' && !resumeOn) missing.resumeOn = 'Pick the date it comes back.'
    setErrors(missing)
    if (Object.keys(missing).length) return

    const done = (message: string) => () => {
      toast({ tone: 'ok', message })
      onClose()
    }
    if (kind === 'POSTPONE') {
      postpone.mutate({ reasonId: Number(reasonId), resumeOn, updatedAt: c.updatedAt }, { onSuccess: done('Case postponed.'), onError })
    } else {
      cancel.mutate({ reasonId: Number(reasonId), updatedAt: c.updatedAt }, { onSuccess: done('Case cancelled.'), onError })
    }
  }

  const message = errorText(action.error)

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="postpone-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="postpone-title">
          Postpone or cancel {c.caseNo}
        </h2>

        <div className="kind-toggle" role="radiogroup" aria-label="Postpone or cancel">
          {(['POSTPONE', 'CANCEL'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => {
                setKind(k)
                setReasonId('')
                setErrors({})
              }}
            >
              {k === 'POSTPONE' ? 'Postpone' : 'Cancel the case'}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="lbl">Reason</span>
          <select className="select" value={reasonId} onChange={(e) => setReasonId(e.target.value)} disabled={reasons.isPending}>
            <option value="">{reasons.isPending ? 'Loading…' : 'Pick a reason…'}</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {errors.reasonId && <span className="field-error">{errors.reasonId}</span>}
          <span className="hint">Fixed reasons only — no free text anywhere.</span>
        </label>

        {kind === 'POSTPONE' ? (
          <label className="field">
            <span className="lbl">Comes back on</span>
            <input className="input" type="date" min={minDate} value={resumeOn} onChange={(e) => setResumeOn(e.target.value)} />
            {errors.resumeOn && <span className="field-error">{errors.resumeOn}</span>}
            <span className="hint">It returns to the follow-up list that day (the next open day if the office is closed).</span>
          </label>
        ) : (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              A cancelled case stays on file but can’t be reopened.
            </p>
            {/* The passports still come back to the client (0006 amendment 15). */}
            {toHandBack(c) && (
              <div className="alert alert-warn">
                The passports are {passportsWhere(c)}. After you cancel, they still go back to the client, with the usual proof, and
                this case stays on {c.owner ? `${firstName(c.owner.name)}’s` : 'its owner’s'} list until they’re handed over.
              </div>
            )}
            {/* Invoices that still stand: how the money is settled after the cancel. */}
            {money.notes.length > 0 && (
              <div className="alert alert-warn">
                {money.notes.map((n) => (
                  <p key={n} style={{ margin: 0 }}>
                    {n}
                  </p>
                ))}
                {money.billFirst && <p style={{ margin: 0 }}>Bill any cancellation charge before you cancel.</p>}
              </div>
            )}
          </>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className={kind === 'CANCEL' ? 'btn btn-dark' : 'btn btn-primary'} disabled={action.isPending} onClick={submit}>
            {action.isPending ? 'Saving…' : kind === 'POSTPONE' ? 'Postpone' : 'Cancel the case'}
          </button>
        </div>
      </div>
    </div>
  )
}
