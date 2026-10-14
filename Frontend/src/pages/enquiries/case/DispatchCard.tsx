import { Link } from 'react-router'
import { formatDateTime } from '../../../lib/format'
import type { VisaCase } from '../types'
import { dayTime, firstName } from './labels'

/**
 * "Dispatch" (demo screen 09 ⚠️, docs/decisions/0008-visa-docket-dispatch.md Decisions 6, 8 and 9), beside the Sticker
 * card. Before dispatch: what the docket still needs (every file's invoice, the vendor's email). After: the courier and
 * its slip, who sent it and when, and when this file comes back due: "Confirm vendor got it". "Dispatch docket" itself
 * is the header's button.
 */
export function DispatchCard({ visaCase: c }: { visaCase: VisaCase }) {
  const d = c.docket
  if (!d || !c.vendor) return null

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
