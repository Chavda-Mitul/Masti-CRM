import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { formatRupees } from '../../../lib/money'
import { useToast } from '../../../lib/toast'
import { enquiryKeys, useInvoiceCheck, useRaiseInvoice } from '../queries'
import type { InvoiceCheck, VisaCase } from '../types'

/** Where each kind of blocker is fixed. */
function fixLink(kind: InvoiceCheck['blockers'][number]['kind'], c: VisaCase) {
  if (kind === 'CLIENT') return <Link to={`/clients/${c.client.id}`}>Open the client</Link>
  if (kind === 'COMPANY') return <Link to="/settings/company">Open Company &amp; invoice</Link>
  return null
}

/**
 * "Raise invoice" (docs/decisions/0009-visa-invoice.md): first what blocks it, with where to fix each thing; then the
 * invoice it will make, amount by amount, and a clear warning that it can never be edited. What the dialog showed (the
 * quote, the GST rate, CGST + SGST or IGST, and the total) is sent back, so an invoice is never made from amounts nobody
 * saw. If any of it changed meanwhile, the amounts are loaded again for another look.
 */
export function RaiseInvoiceDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const check = useInvoiceCheck(c.caseNo)
  const raise = useRaiseInvoice(c.caseNo)

  // The server's list wins when it disagrees (someone changed the client or Masti's details meanwhile).
  const serverBlockers =
    errorCode(raise.error) === 'INVOICE_BLOCKED' ? (errorBody(raise.error)?.details?.blockers as InvoiceCheck['blockers'] | undefined) : undefined
  const blockers = serverBlockers ?? check.data?.blockers ?? []
  const preview = serverBlockers ? null : check.data?.preview
  const message = serverBlockers ? null : errorText(raise.error)
  const q = c.quote

  const submit = () => {
    if (!preview) return
    const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = preview
    raise.mutate(
      { quoteUpdatedAt, taxType, gstRatePercent, totalPaise },
      {
        onSuccess: (updated) => {
          toast({ tone: 'ok', message: `Invoice ${updated.invoice?.invoiceNo ?? ''} raised.` })
          onClose()
        },
        onError: (err) => {
          if (['INVOICE_BLOCKED', 'INVOICE_CHANGED', 'STALE'].includes(errorCode(err) ?? '')) {
            void queryClient.invalidateQueries({ queryKey: enquiryKeys.invoiceCheck(c.caseNo) })
          }
        },
      },
    )
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="invoice-title">
          {check.data?.replaces ? 'Raise the corrected invoice' : 'Raise the invoice'}
        </h2>
        {check.data?.replaces && (
          <p className="muted small" style={{ margin: 0 }}>
            It replaces <span className="mono">{check.data.replaces}</span>, cancelled by its credit note. It doesn’t use up the
            file’s one additional invoice.
          </p>
        )}

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : blockers.length > 0 ? (
          <div className="alert alert-warn">
            <strong>Not ready yet.</strong>
            <ul className="missing-list">
              {blockers.map((b) => (
                <li key={b.kind}>
                  {b.label}
                  {b.items.length > 0 && <> {b.items.join(', ')}.</>} {fixLink(b.kind, c)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          preview &&
          q && (
            <>
              <div className="invoice-summary">
                {c.travellers.map((t) => {
                  const line = q.lines.find((l) => l.travellerId === t.id)
                  return (
                    <div key={t.id} className="kv">
                      <span>{t.member?.name ?? t.name ?? t.label}</span>
                      <span>{line ? formatRupees(line.totalPaise) : '—'}</span>
                    </div>
                  )
                })}
                {preview.serviceChargePaise > 0 && (
                  <div className="kv">
                    <span>Processing charges</span>
                    <span>{formatRupees(preview.serviceChargePaise)}</span>
                  </div>
                )}
                {preview.taxType === 'INTRA_STATE' && preview.cgstPaise + preview.sgstPaise > 0 && (
                  <>
                    <div className="kv">
                      <span>CGST {preview.gstRatePercent / 2}%</span>
                      <span>{formatRupees(preview.cgstPaise)}</span>
                    </div>
                    <div className="kv">
                      <span>SGST {preview.gstRatePercent / 2}%</span>
                      <span>{formatRupees(preview.sgstPaise)}</span>
                    </div>
                  </>
                )}
                {preview.taxType === 'INTER_STATE' && preview.igstPaise > 0 && (
                  <div className="kv">
                    <span>IGST {preview.gstRatePercent}%</span>
                    <span>{formatRupees(preview.igstPaise)}</span>
                  </div>
                )}
                <div className="kv invoice-total">
                  <span>Total</span>
                  <strong>{formatRupees(preview.totalPaise)}</strong>
                </div>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {q.processingSpeed.name} processing · to {c.client.name}. Its number will be <span className="mono">{preview.invoiceNo}</span>.
              </p>
              <div className="alert alert-warn">
                <strong>Once raised, the invoice is locked.</strong> It can never be edited, and the quote can’t change after it.
                Check the amounts above.
              </div>
            </>
          )
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!preview || blockers.length > 0 || raise.isPending || check.isFetching} onClick={submit}>
            {raise.isPending ? 'Raising…' : preview ? `Raise invoice ${preview.invoiceNo}` : 'Raise invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
