import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { formatRupees, parseRupees } from '../../../lib/money'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { enquiryKeys, useAdditionalInvoiceCheck, useRaiseAdditionalInvoice } from '../queries'
import type { AdditionalInvoiceCheck, VisaCase } from '../types'

interface Row {
  chargeId: string
  amount: string
}

/**
 * The file's one additional invoice (demo screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 7): extra costs
 * after the main invoice, such as an urgent submission charge or photos. Each charge is picked from the list and its
 * amount typed; several go on the one invoice. Numbered after the main invoice ("MVI00000001-A"), with no GST, and
 * locked once raised. The main invoice and total shown are sent back, so a change meanwhile is refused.
 */
export function AdditionalInvoiceDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const check = useAdditionalInvoiceCheck(c.caseNo)
  const raise = useRaiseAdditionalInvoice(c.caseNo)
  const list = useMasterList('extra-charges')
  const options = (list.data ?? []).filter((ch) => ch.isActive)
  const [rows, setRows] = useState<Row[]>([{ chargeId: '', amount: '' }])
  const [error, setError] = useState<string | null>(null)

  const amounts = rows.map((r) => parseRupees(r.amount))
  const total = amounts.reduce<number>((n, a) => n + (a ?? 0), 0)
  const serverBlockers =
    errorCode(raise.error) === 'ADDITIONAL_BLOCKED' ? (errorBody(raise.error)?.details?.blockers as AdditionalInvoiceCheck['blockers'] | undefined) : undefined
  const blockers = serverBlockers ?? check.data?.blockers ?? []
  const message = serverBlockers || errorBody(raise.error)?.issues ? null : errorText(raise.error)
  const ready = !!check.data && !check.data.alreadyRaised && blockers.length === 0

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const press = () => {
    if (!check.data) return
    if (rows.some((r) => !r.chargeId)) return setError('Pick the charge on every line.')
    if (amounts.some((a) => a === null || a === undefined || a <= 0)) return setError('Enter an amount above 0 on every line.')
    setError(null)
    raise.mutate(
      {
        mainInvoiceNo: check.data.mainInvoiceNo,
        charges: rows.map((r, i) => ({ chargeId: Number(r.chargeId), amountPaise: amounts[i]! })),
        totalPaise: total,
      },
      {
        onSuccess: (updated) => {
          toast({ tone: 'ok', message: `Additional invoice ${updated.additionalInvoice?.invoiceNo ?? ''} raised.` })
          onClose()
        },
        onError: (err) => {
          setError(errorBody(err)?.issues?.charges?.[0] ?? null)
          if (errorCode(err) === 'ADDITIONAL_CHANGED') void queryClient.invalidateQueries({ queryKey: enquiryKeys.additionalInvoiceCheck(c.caseNo) })
        },
      },
    )
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="additional-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="additional-title">
          Additional invoice
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          For extra costs after the main invoice, such as an urgent submission or photos. A file gets only one, so add every
          charge now. No GST is charged on them.
        </p>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : check.data.alreadyRaised ? (
          <div className="alert alert-warn">
            This file’s one additional invoice is <span className="mono">{check.data.alreadyRaised}</span>: 1 of 1 used.
          </div>
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={i} className="additional-row">
                <select
                  className="select"
                  aria-label={`Charge ${i + 1}`}
                  value={r.chargeId}
                  onChange={(e) => setRow(i, { chargeId: e.target.value })}
                  disabled={raise.isPending}
                >
                  <option value="">{list.isPending ? 'Loading…' : 'Pick the charge…'}</option>
                  {options.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  inputMode="decimal"
                  aria-label={`Amount ${i + 1}`}
                  placeholder="₹ amount"
                  value={r.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                  disabled={raise.isPending}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={rows.length === 1 || raise.isPending}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            {rows.length < 10 && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ alignSelf: 'flex-start' }}
                disabled={raise.isPending}
                onClick={() => setRows([...rows, { chargeId: '', amount: '' }])}
              >
                Add a charge
              </button>
            )}
            <div className="invoice-summary">
              <div className="kv invoice-total">
                <span>
                  <span className="mono">{check.data.invoiceNo}</span> · after <span className="mono">{check.data.mainInvoiceNo}</span> · no GST
                </span>
                <strong>{formatRupees(total)}</strong>
              </div>
            </div>
            {blockers.length > 0 && (
              <div className="alert alert-warn">
                <strong>Not ready yet.</strong>
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
            <div className="alert alert-warn">
              <strong>Once raised, it’s locked.</strong> It can never be edited, and a file gets only one.
            </div>
          </>
        )}

        {error && <span className="field-error">{error}</span>}
        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || raise.isPending} onClick={press}>
            {raise.isPending ? 'Raising…' : `Raise ${check.data?.invoiceNo ?? 'additional invoice'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
