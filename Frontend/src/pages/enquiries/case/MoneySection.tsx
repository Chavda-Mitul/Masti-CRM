import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatDate } from '../../../lib/format'
import { formatRupees } from '../../../lib/money'
import type { VisaCase } from '../types'
import { useOpenCaseFile } from '../queries'
import { AdditionalInvoiceDialog } from './AdditionalInvoiceDialog'
import { CancelInvoiceDialog } from './CancelInvoiceDialog'
import { dayMonth, liveInvoice } from './labels'
import { QuoteDialog } from './QuoteDialog'
import { RaiseInvoiceDialog } from './RaiseInvoiceDialog'

/**
 * The quote can change from Step 1 until the file goes to the vendor (Backend caseLock.ts QUOTING), and at any step
 * while a cancelled invoice waits for its replacement (0011 Decision 5).
 */
const QUOTE_STEPS = ['ENQUIRY', 'DOCUMENTS', 'FILE_PREPARATION', 'DISPATCH']

/**
 * "Money on this case" (demo screen 09 ⚠️, docs/decisions/0009-visa-invoice.md Decision 2): the quote, each traveller's
 * amount, Masti's service charge, GST on it and the total. The case's owner, its HOD or the Head add or edit it until the
 * file goes to the vendor, and raise the locked tax invoice from it. Once raised, the invoice shows here with its PDF, and
 * the quote can't change. A wrong invoice is cancelled with a credit note (0011 Decision 5), at any step; the quote
 * then reopens, and the corrected invoice raised from it replaces the cancelled one. Earlier invoices are listed below.
 */
export function MoneySection({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [editing, setEditing] = useState(false)
  const [raising, setRaising] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [adding, setAdding] = useState(false)
  const [cancellingAdditional, setCancellingAdditional] = useState(false)
  const openFile = useOpenCaseFile(c.caseNo)
  const q = c.quote
  const invoice = c.invoice
  const cancelled = invoice?.cancelled ?? null
  const canAct =
    !!me &&
    c.status === 'OPEN' &&
    (QUOTE_STEPS.includes(c.stage.code) || !!cancelled) &&
    canActOnCase(me, { department: c.department.code, owner: c.owner })
  const canEdit = canAct && !liveInvoice(c)
  // The one additional invoice (0011 Decision 7): at any step once the main invoice stands, while the case is open. A
  // credit note cancels a wrong one, and its correction ("-B") is raised the same way, still 1 of 1.
  const additional = c.additionalInvoice
  const additionalCancelled = additional?.cancelled ?? null
  const actsOnCase = !!me && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const canAdd = actsOnCase && !!liveInvoice(c) && (!additional || !!additionalCancelled)
  const canCancelAdditional = actsOnCase && !!additional && !additionalCancelled
  // An invoice a recall gave part of can't be cancelled whole (0011 Decision 5: never more than invoiced).
  const canCancel =
    !!me &&
    c.status === 'OPEN' &&
    !!invoice &&
    !cancelled &&
    invoice.partCredits.length === 0 &&
    canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <div className="rail-section money-section" id="money">
      <div className="lbl">Money on this case</div>
      {invoice && (
        <div className={`money-invoice${cancelled ? ' is-cancelled' : ''}`}>
          <div className="money-invoice-head">
            {cancelled ? (
              <span className="chip chip-bad">
                <span className="mono">{invoice.invoiceNo}</span> · cancelled
              </span>
            ) : (
              <span className="chip chip-ok">
                <span className="mono">{invoice.invoiceNo}</span> · locked
              </span>
            )}
            <strong className="money-invoice-total">{formatRupees(invoice.totalPaise)}</strong>
          </div>
          <span className="muted small">
            Raised by {invoice.issuedBy.name}, {dayMonth(invoice.issuedAt)}
          </span>
          {invoice.replaces && (
            <span className="muted small">
              Replaces <span className="mono">{invoice.replaces}</span>
            </span>
          )}
          {invoice.partCredits.map((p) => (
            <span key={p.creditNoteNo} className="muted small">
              <span className="mono">{p.creditNoteNo}</span> gave back {formatRupees(p.totalPaise)} · {p.reason}{' '}
              <button type="button" className="btn-link small" onClick={() => openFile(p.file.id)}>
                Open
              </button>
            </span>
          ))}
          {cancelled && (
            <span className="muted small">
              Cancelled by <span className="mono">{cancelled.creditNoteNo}</span> · {cancelled.reason} · {cancelled.issuedBy.name},{' '}
              {formatDate(cancelled.issuedOn)}
            </span>
          )}
          <div className="money-invoice-actions">
            <button type="button" className="btn btn-sm" onClick={() => openFile(invoice.file.id)}>
              Open invoice
            </button>
            {cancelled && (
              <button type="button" className="btn btn-sm" onClick={() => openFile(cancelled.file.id)}>
                Open credit note
              </button>
            )}
            {canCancel && (
              <button type="button" className="btn btn-sm" onClick={() => setCancelling(true)}>
                Cancel with a credit note
              </button>
            )}
          </div>
        </div>
      )}
      {q ? (
        <>
          <div className="money-rows">
            {c.travellers.map((t) => {
              const line = q.lines.find((l) => l.travellerId === t.id)
              return (
                <div key={t.id} className="kv">
                  <span>{t.member?.name ?? t.name ?? t.label}</span>
                  <span>{line ? formatRupees(line.totalPaise) : '—'}</span>
                </div>
              )
            })}
            <div className="kv">
              <span>Service charge</span>
              <span>{formatRupees(q.serviceChargePaise)}</span>
            </div>
            <div className="kv">
              <span>GST {q.gstRatePercent}%</span>
              <span>{formatRupees(q.gstPaise)}</span>
            </div>
            <div className="kv money-total">
              <span>Total</span>
              <strong>{formatRupees(q.totalPaise)}</strong>
            </div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {q.processingSpeed.name} processing · quoted by {q.updatedBy.name}, {dayMonth(q.updatedAt)}
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          No quote yet.
        </p>
      )}
      {canEdit && (
        <div className="money-actions">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            {q ? 'Edit quote' : 'Add quote'}
          </button>
          {q?.complete && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setRaising(true)}>
              {cancelled ? 'Raise the corrected invoice' : 'Raise invoice'}
            </button>
          )}
        </div>
      )}
      {(additional || canAdd) && (
        <div className="money-additional">
          <div className="money-invoice-head">
            <span className="lbl">Additional invoice</span>
            <span className={`chip chip-sm ${additional ? 'chip-warn' : 'chip-muted'}`}>{additional ? '1 of 1 used' : '0 of 1 used'}</span>
          </div>
          {additional && (
            <div className={`money-invoice${additionalCancelled ? ' is-cancelled' : ''}`}>
              <div className="money-invoice-head">
                {additionalCancelled ? (
                  <span className="chip chip-bad">
                    <span className="mono">{additional.invoiceNo}</span> · cancelled
                  </span>
                ) : (
                  <span className="chip chip-ok">
                    <span className="mono">{additional.invoiceNo}</span> · locked
                  </span>
                )}
                <strong>{formatRupees(additional.totalPaise)}</strong>
              </div>
              {additional.charges.map((ch, i) => (
                <span key={i} className="muted small">
                  {ch.name} · {formatRupees(ch.amountPaise)}
                </span>
              ))}
              <span className="muted small">
                Raised by {additional.issuedBy.name}, {dayMonth(additional.issuedAt)} · no GST
              </span>
              {additional.replaces && (
                <span className="muted small">
                  Replaces <span className="mono">{additional.replaces}</span>
                </span>
              )}
              {additionalCancelled && (
                <span className="muted small">
                  Cancelled by <span className="mono">{additionalCancelled.creditNoteNo}</span> · {additionalCancelled.reason} ·{' '}
                  {additionalCancelled.issuedBy.name}, {formatDate(additionalCancelled.issuedOn)}
                </span>
              )}
              <div className="money-invoice-actions">
                <button type="button" className="btn btn-sm" onClick={() => openFile(additional.file.id)}>
                  Open invoice
                </button>
                {additionalCancelled && (
                  <button type="button" className="btn btn-sm" onClick={() => openFile(additionalCancelled.file.id)}>
                    Open credit note
                  </button>
                )}
                {canCancelAdditional && (
                  <button type="button" className="btn btn-sm" onClick={() => setCancellingAdditional(true)}>
                    Cancel with a credit note
                  </button>
                )}
              </div>
            </div>
          )}
          {canAdd && (
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
              {additionalCancelled ? 'Raise the corrected additional invoice' : 'Raise additional invoice'}
            </button>
          )}
          {c.earlierAdditionalInvoices.length > 0 && (
            <div className="money-earlier">
              <span className="muted small">Earlier additional invoices</span>
              {c.earlierAdditionalInvoices.map((e) => (
                <div key={e.invoiceNo} className="kv">
                  <span className="small">
                    <span className="mono">{e.invoiceNo}</span> · cancelled by <span className="mono">{e.cancelled?.creditNoteNo}</span>
                  </span>
                  <span className="money-earlier-actions">
                    <button type="button" className="btn-link small" onClick={() => openFile(e.file.id)}>
                      Invoice
                    </button>
                    {e.cancelled && (
                      <button type="button" className="btn-link small" onClick={() => openFile(e.cancelled!.file.id)}>
                        Credit note
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {c.earlierInvoices.length > 0 && (
        <div className="money-earlier">
          <span className="muted small">Earlier invoices</span>
          {c.earlierInvoices.map((e) => (
            <div key={e.invoiceNo} className="kv">
              <span className="small">
                <span className="mono">{e.invoiceNo}</span> · cancelled by <span className="mono">{e.cancelled?.creditNoteNo}</span>
              </span>
              <span className="money-earlier-actions">
                <button type="button" className="btn-link small" onClick={() => openFile(e.file.id)}>
                  Invoice
                </button>
                {e.cancelled && (
                  <button type="button" className="btn-link small" onClick={() => openFile(e.cancelled!.file.id)}>
                    Credit note
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {editing && <QuoteDialog visaCase={c} onClose={() => setEditing(false)} />}
      {raising && <RaiseInvoiceDialog visaCase={c} onClose={() => setRaising(false)} />}
      {cancelling && <CancelInvoiceDialog visaCase={c} onClose={() => setCancelling(false)} />}
      {adding && <AdditionalInvoiceDialog visaCase={c} onClose={() => setAdding(false)} />}
      {cancellingAdditional && additional && (
        <CancelInvoiceDialog visaCase={c} invoiceNo={additional.invoiceNo} onClose={() => setCancellingAdditional(false)} />
      )}
    </div>
  )
}
