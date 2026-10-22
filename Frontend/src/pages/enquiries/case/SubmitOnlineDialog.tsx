import { useQueryClient } from '@tanstack/react-query'
import { errorBody, errorCode, errorText, lostAccess } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { enquiryKeys, useSubmitOnline, useSubmitOnlineCheck } from '../queries'
import type { SubmitOnlineCheck, VisaCase } from '../types'
import { dayTime, firstName, liveInvoice } from './labels'

/**
 * "Submitted online" (docs/decisions/0008-visa-docket-dispatch.md Decision 11): an e-visa went in on the portal, so there
 * is no docket, sticker or courier. Refused until the invoice is raised; then the case moves to At vendor, due back on
 * its processor's desk to check the portal.
 */
export function SubmitOnlineDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const check = useSubmitOnlineCheck(c.caseNo)
  const submit = useSubmitOnline(c.caseNo)

  // The server's list wins when it disagrees (the invoice changed meanwhile).
  const serverBlockers =
    errorCode(submit.error) === 'SUBMIT_BLOCKED' ? (errorBody(submit.error)?.details?.blockers as SubmitOnlineCheck['blockers'] | undefined) : undefined
  const blockers = serverBlockers ?? check.data?.blockers ?? []
  const message = serverBlockers ? null : errorText(submit.error)
  const ready = !!check.data && blockers.length === 0

  const press = () =>
    submit.mutate(
      { updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `${c.caseNo} submitted online. It’s now at the vendor step.` })
          onClose()
        },
        onError: (err) => {
          if (errorCode(err) === 'SUBMIT_BLOCKED') void queryClient.invalidateQueries({ queryKey: enquiryKeys.submitOnlineCheck(c.caseNo) })
        },
      },
    )
  const raiseFirst = () => {
    onClose()
    document.getElementById('money')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog dispatch-dialog" role="dialog" aria-modal="true" aria-labelledby="online-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="online-title">
          Submitted online
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Press this once <span className="mono">{c.caseNo}</span> is in on the {c.country.name} visa portal. This visa needs no vendor:
          there’s no docket, sticker or courier.
        </p>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isLoadingError || lostAccess(check) ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : blockers.length > 0 ? (
          <div className="alert alert-warn">
            <strong>Not ready yet.</strong>
            <ul className="missing-list">
              {blockers.map((b) => (
                <li key={b.kind}>
                  {b.label}{' '}
                  {b.kind === 'INVOICE' && (
                    <button type="button" className="btn-link" onClick={raiseFirst}>
                      Raise it →
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="dispatch-files">
            <div className="kv">
              <span>Invoice</span>
              <strong>
                <span className="mono">{liveInvoice(c)?.invoiceNo}</span> · locked
              </strong>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              The case moves to <strong>At vendor</strong>, due back {c.owner && <>on {firstName(c.owner.name)}’s desk </>}
              <strong>{dayTime(check.data.dueAt)}</strong> to check the portal.
            </p>
          </div>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || submit.isPending} onClick={press} autoFocus>
            {submit.isPending ? 'Saving…' : 'Mark submitted'}
          </button>
        </div>
      </div>
    </div>
  )
}
