import { Link } from 'react-router'
import { canDispatchDocket } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useResendDocketEmail } from '../queries'
import type { VisaCase } from '../types'
import { dayTime, firstName } from './labels'

/**
 * "Dispatch" (demo screen 09 ⚠️, docs/decisions/0008-visa-docket-dispatch.md Decisions 6, 8 and 9), beside the Sticker
 * card. Before dispatch: what the docket still needs (every file's invoice, the vendor's email). After: the courier and
 * its slip, who sent it and when, the email to the vendor (or why it failed, with Send again), and when this file comes
 * back due: "Confirm vendor got it". "Dispatch docket" itself is the header's button.
 */
export function DispatchCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const resend = useResendDocketEmail(c.caseNo)
  const d = c.docket
  if (!d || !c.vendor) return null
  const canSend = !!me && canDispatchDocket(me, d.cases.map((r) => r.ownerId))
  const sendAgain = () =>
    resend.mutate(undefined, {
      onSuccess: (updated) =>
        updated.docket?.email?.sentAt
          ? toast({ tone: 'ok', message: `Email sent to ${updated.docket.email.to ?? 'the vendor'}.` })
          : toast({ tone: 'bad', message: 'The email still couldn’t be sent.' }),
      onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t send. Please try again.' }),
    })

  if (d.status === 'DISPATCHED') {
    return (
      <section className="card pad dispatch-card">
        <h2 className="h2">Dispatch</h2>
        <div>
          <div className="kv">
            <span>Courier</span>
            <strong>
              {d.courier?.name}
              {d.awbNo && (
                <>
                  {' '}
                  · slip <span className="mono">{d.awbNo}</span>
                </>
              )}
            </strong>
          </div>
          <div className="kv">
            <span>Dispatched</span>
            <strong>
              {d.dispatchedAt && formatDateTime(d.dispatchedAt)}
              {d.dispatchedBy && ` · ${d.dispatchedBy.name}`}
            </strong>
          </div>
          <div className="kv">
            <span>Email to vendor</span>
            {d.email?.sentAt ? (
              <strong>Sent with the docket list · {formatDateTime(d.email.sentAt)}</strong>
            ) : (
              <strong className="dispatch-bad">Not sent</strong>
            )}
          </div>
          {c.stage.code === 'AT_VENDOR' && c.dueAt && (
            <div className="kv">
              <span>
                {dayTime(c.dueAt)}
                {c.owner && ` · ${firstName(c.owner.name)}`}
              </span>
              <strong>Confirm vendor got it</strong>
            </div>
          )}
        </div>
        {d.email && !d.email.sentAt && (
          <div className="alert alert-bad dispatch-email-failed">
            <span>{d.email.error ?? 'The email to the vendor hasn’t gone yet.'}</span>
            {canSend && (
              <button type="button" className="btn btn-sm" disabled={resend.isPending} onClick={sendAgain}>
                {resend.isPending ? 'Sending…' : 'Send again'}
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  const invoiced = d.cases.filter((r) => r.invoiceNo).length
  const allInvoiced = invoiced === d.cases.length
  return (
    <section className="card pad dispatch-card">
      <h2 className="h2">Dispatch</h2>
      <div>
        <div className="kv">
          <span>Invoices</span>
          <strong className={allInvoiced ? undefined : 'dispatch-warn'}>
            {invoiced} of {d.cases.length} raised
          </strong>
        </div>
        <div className="kv">
          <span>Email to vendor</span>
          {c.vendor.email ? (
            <strong>{c.vendor.email}</strong>
          ) : (
            <strong className="dispatch-warn">
              None yet · <Link to="/settings/masters/lists?tab=vendors">Vendors</Link>
            </strong>
          )}
        </div>
        <div className="kv">
          <span>Courier</span>
          <strong className="muted">Picked at dispatch</strong>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {allInvoiced && c.vendor.email
          ? `Ready. Dispatch docket ${d.docketNo} from the button at the top.`
          : `The docket can go once every file has its invoice and ${c.vendor.name} has an email.`}
      </p>
    </section>
  )
}
