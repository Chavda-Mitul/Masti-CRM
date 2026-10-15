import { useState } from 'react'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { formatRupees, parseRupees, rupeesInput } from '../../../lib/money'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useRecallCheck, useRecallFile } from '../queries'
import type { RecallCheck, VisaCase } from '../types'
import { dayTime, firstName } from './labels'

/**
 * "Take the file back (recall)" (demo screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 6): why, from the
 * recall-reasons list, and what goes back per traveller. By default each traveller's embassy fee (nothing on a lump
 * sum); VFS, Masti's service charge and the courier are kept. The Visa HOD or the Head can give back more ("Change
 * refund (HOD)"), each traveller up to what they were charged, never the service charge. The case then goes to Passport
 * back.
 */
export function RecallDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const check = useRecallCheck(c.caseNo)
  const recall = useRecallFile(c.caseNo)
  const reasons = useMasterList('recall-reasons')
  const options = (reasons.data ?? []).filter((r) => r.isActive)
  const [reasonId, setReasonId] = useState('')
  const [changing, setChanging] = useState(false)
  const [typed, setTyped] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const lines = check.data?.lines ?? []

  /** The refund a traveller gets: what the HOD typed while changing, else the default. undefined when it can't be read. */
  const refundOf = (l: RecallCheck['lines'][number]) => (changing && typed[l.position] !== undefined ? parseRupees(typed[l.position]!) : l.defaultRefundPaise)
  const total = lines.reduce((n, l) => n + (refundOf(l) ?? 0), 0)
  const serverBlockers =
    errorCode(recall.error) === 'RECALL_BLOCKED' ? (errorBody(recall.error)?.details?.blockers as RecallCheck['blockers'] | undefined) : undefined
  const blockers = total > 0 ? (serverBlockers ?? check.data?.blockers ?? []) : []
  const message = serverBlockers || errorBody(recall.error)?.issues ? null : errorText(recall.error)

  const press = () => {
    if (!check.data) return
    const missing: Record<string, string> = {}
    if (!reasonId) missing.reasonId = 'Pick why it’s taken back.'
    const refunds = lines.map((l) => ({ position: l.position, refundPaise: refundOf(l) }))
    const bad = refunds.find((r, i) => r.refundPaise === undefined || r.refundPaise === null || r.refundPaise < lines[i]!.defaultRefundPaise || r.refundPaise > lines[i]!.chargedPaise)
    if (changing && bad) missing.refunds = 'Each refund is at least the embassy fee and no more than that traveller was charged.'
    setErrors(missing)
    if (Object.keys(missing).length) return
    recall.mutate(
      {
        invoiceNo: check.data.invoiceNo,
        reasonId: Number(reasonId),
        updatedAt: c.updatedAt,
        ...(changing ? { refunds: refunds.map((r) => ({ position: r.position, refundPaise: r.refundPaise ?? 0 })) } : {}),
      },
      {
        onSuccess: (updated) => {
          const note = updated.recall?.creditNote
          toast({ tone: 'ok', message: note ? `File taken back. ${note.creditNoteNo} gives back ${formatRupees(note.totalPaise)}.` : 'File taken back.' })
          onClose()
        },
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, msgs]) => [field, msgs?.[0] ?? ''])))
        },
      },
    )
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="recall-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="recall-title">
          Take the file back
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          The papers come back from {c.vendor?.name ?? 'the vendor'}. The embassy fee goes back; VFS, the service charge and the
          courier both ways are kept.
        </p>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : (
          <>
            <div className="invoice-summary">
              {lines.map((l) => (
                <div key={l.position} className="kv">
                  <span>
                    {l.name}
                    <span className="muted small">
                      {' '}
                      · {l.form === 'ITEMISED' ? `embassy fee ${formatRupees(l.embassyFeePaise ?? 0)}` : 'lump sum'} · charged {formatRupees(l.chargedPaise)}
                    </span>
                  </span>
                  {changing ? (
                    <input
                      className="input recall-refund"
                      inputMode="decimal"
                      aria-label={`Refund for ${l.name}`}
                      value={typed[l.position] ?? rupeesInput(l.defaultRefundPaise)}
                      onChange={(e) => setTyped({ ...typed, [l.position]: e.target.value })}
                      disabled={recall.isPending}
                    />
                  ) : (
                    <span>{formatRupees(l.defaultRefundPaise)}</span>
                  )}
                </div>
              ))}
              <div className="kv invoice-total">
                <span>{total > 0 ? `Credit note ${check.data.creditNoteNo} gives back` : 'Nothing is given back'}</span>
                <strong>{formatRupees(total)}</strong>
              </div>
            </div>
            {errors.refunds && <span className="field-error">{errors.refunds}</span>}
            {check.data.canChangeRefund ? (
              !changing && (
                <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setChanging(true)}>
                  Change refund (HOD)
                </button>
              )
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Only an HOD can return more, case by case.
              </p>
            )}

            {blockers.length > 0 && (
              <div className="alert alert-warn">
                <strong>The credit note can’t be issued yet.</strong>
                <ul className="missing-list">
                  {blockers.map((b) => (
                    <li key={b.kind}>
                      {b.label}
                      {b.items.length > 0 && <> {b.items.join(', ')}.</>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="field">
              <span className="lbl">Why it’s taken back</span>
              <select className="select" value={reasonId} onChange={(e) => setReasonId(e.target.value)} disabled={recall.isPending}>
                <option value="">{reasons.isPending ? 'Loading…' : 'Pick the reason…'}</option>
                {options.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {errors.reasonId && <span className="field-error">{errors.reasonId}</span>}
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              The case moves to <strong>Passport back</strong>, due back {c.owner && <>on {firstName(c.owner.name)}’s desk </>}
              <strong>{dayTime(check.data.dueAt)}</strong> to chase the vendor for the papers.
            </p>
          </>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Keep it with the vendor
          </button>
          <button type="button" className="btn btn-danger" disabled={!check.data || blockers.length > 0 || recall.isPending} onClick={press}>
            {recall.isPending ? 'Taking it back…' : 'Take the file back'}
          </button>
        </div>
      </div>
    </div>
  )
}
