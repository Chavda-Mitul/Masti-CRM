import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useVendorReceived, useVendorReceivedCheck } from '../queries'
import type { VisaCase } from '../types'
import { dayTime, firstName } from './labels'

/**
 * "Vendor got it, papers checked" (docs/decisions/0011-visa-at-vendor.md Decision 2), for this file only: the other files
 * in its docket are confirmed on their own pages. The file then comes back due when the vendor submits it, at the
 * earliest appointment still to come, or the next office day ⚠️.
 */
export function VendorReceivedDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const check = useVendorReceivedCheck(c.caseNo)
  const save = useVendorReceived(c.caseNo)
  const vendor = c.vendor?.name ?? 'the vendor'

  const press = () =>
    save.mutate(
      { updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `Recorded: ${vendor} has ${c.caseNo}.` })
          onClose()
        },
      },
    )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog dispatch-dialog" role="dialog" aria-modal="true" aria-labelledby="received-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="received-title">
          Vendor got it
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Did <strong>{vendor}</strong> get <span className="mono">{c.caseNo}</span> in docket{' '}
          <span className="mono">{c.docket?.docketNo}</span>, with its papers in order? This records it for this file only.
        </p>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            The file comes back due {c.owner && <>on {firstName(c.owner.name)}’s desk </>}
            <strong>{dayTime(check.data.dueAt)}</strong>
            {check.data.dueReason === 'APPOINTMENT' ? ', at the embassy appointment,' : ''} to get the file number.
          </p>
        )}

        {save.error && <div className="alert alert-bad">{errorText(save.error)}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!check.data || save.isPending} onClick={press} autoFocus>
            {save.isPending ? 'Saving…' : 'Yes, vendor got it'}
          </button>
        </div>
      </div>
    </div>
  )
}
