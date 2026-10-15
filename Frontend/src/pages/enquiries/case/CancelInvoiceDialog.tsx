import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { formatRupees } from '../../../lib/money'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { enquiryKeys, useCancelInvoice, useCancelInvoiceCheck } from '../queries'
import type { CancelInvoiceCheck, VisaCase } from '../types'

/**
 * "Cancel with a credit note" (docs/decisions/0011-visa-at-vendor.md Decision 5). A wrong invoice is never changed: a
 * WHOLE credit note cancels it, giving back everything it charged, its GST included, so the tax reports net to zero. The
 * reason is picked from the credit-note reasons list. The invoice and total shown are sent back, so a change meanwhile
 * is refused rather than cancelling something nobody saw. `invoiceNo` picks the additional invoice (Decision 7), which
 * has no GST; without it, the main invoice.
 */
export function CancelInvoiceDialog({ visaCase: c, invoiceNo, onClose }: { visaCase: VisaCase; invoiceNo?: string; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const check = useCancelInvoiceCheck(c.caseNo, invoiceNo)
  const cancel = useCancelInvoice(c.caseNo)
  const reasons = useMasterList('credit-note-reasons')
  const [reasonId, setReasonId] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const options = (reasons.data ?? []).filter((r) => r.isActive)

  const serverBlockers =
    errorCode(cancel.error) === 'CREDIT_NOTE_BLOCKED' ? (errorBody(cancel.error)?.details?.blockers as CancelInvoiceCheck['blockers'] | undefined) : undefined
  const blockers = serverBlockers ?? check.data?.blockers ?? []
  const message = serverBlockers || errorBody(cancel.error)?.issues ? null : errorText(cancel.error)
  const p = check.data?.preview
  const ready = !!check.data && !check.data.alreadyCancelled && blockers.length === 0

  const press = () => {
    if (!check.data || !p) return
    if (!reasonId) {
      setReasonError('Pick why it’s cancelled.')
      return
    }
    setReasonError(null)
    cancel.mutate(
      { invoiceNo: check.data.invoiceNo, totalPaise: p.totalPaise, reasonId: Number(reasonId) },
      {
        onSuccess: (updated) => {
          const note = (invoiceNo ? updated.additionalInvoice : updated.invoice)?.cancelled?.creditNoteNo
          toast({ tone: 'ok', message: `Invoice ${check.data.invoiceNo} cancelled by ${note ?? 'a credit note'}.` })
          onClose()
        },
        onError: (err) => {
          setReasonError(errorBody(err)?.issues?.reasonId?.[0] ?? null)
          if (errorCode(err) === 'CREDIT_NOTE_CHANGED' || errorCode(err) === 'CREDIT_NOTE_BLOCKED') {
            void queryClient.invalidateQueries({ queryKey: enquiryKeys.cancelInvoiceCheck(c.caseNo, invoiceNo) })
          }
        },
      },
    )
  }

  const row = (label: string, paise: number) => (
    <div className="kv">
      <span>{label}</span>
      <span>{formatRupees(paise)}</span>
    </div>
  )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-invoice-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="cancel-invoice-title">
          Cancel invoice {check.data?.invoiceNo ?? invoiceNo ?? c.invoice?.invoiceNo}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {invoiceNo
            ? 'An invoice is never changed. A credit note cancels it, giving back every extra charge. A corrected additional invoice can then be raised; it still counts as the file’s one.'
            : 'An invoice is never changed. A credit note cancels it, giving back everything it charged, GST included. A corrected invoice can then be raised.'}
        </p>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : check.data.alreadyCancelled ? (
          <div className="alert alert-warn">
            Already cancelled by <span className="mono">{check.data.alreadyCancelled}</span>.
          </div>
        ) : (
          <>
            {p && (
              <div className="invoice-summary">
                {row(invoiceNo ? 'Extra charges' : 'Travellers’ amounts', p.grossPaise)}
                {p.serviceChargePaise > 0 && row('Service charge', p.serviceChargePaise)}
                {p.taxType === 'INTRA_STATE' ? (
                  <>
                    {p.cgstPaise > 0 && row('CGST', p.cgstPaise)}
                    {p.sgstPaise > 0 && row('SGST', p.sgstPaise)}
                  </>
                ) : (
                  p.igstPaise > 0 && row('IGST', p.igstPaise)
                )}
                <div className="kv invoice-total">
                  <span>Credit note {p.creditNoteNo} gives back</span>
                  <strong>{formatRupees(p.totalPaise)}</strong>
                </div>
              </div>
            )}
            {blockers.length > 0 ? (
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
            ) : (
              <label className="field">
                <span className="lbl">Why it’s cancelled</span>
                <select className="select" value={reasonId} onChange={(e) => setReasonId(e.target.value)} disabled={cancel.isPending} autoFocus>
                  <option value="">{reasons.isPending ? 'Loading…' : 'Pick the reason…'}</option>
                  {options.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {reasonError && <span className="field-error">{reasonError}</span>}
              </label>
            )}
          </>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Keep the invoice
          </button>
          <button type="button" className="btn btn-danger" disabled={!ready || cancel.isPending} onClick={press}>
            {cancel.isPending ? 'Issuing…' : `Issue credit note${p ? ` ${p.creditNoteNo}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
