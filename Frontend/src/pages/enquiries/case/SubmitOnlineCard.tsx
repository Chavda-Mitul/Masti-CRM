import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatDateTime } from '../../../lib/format'
import type { VisaCase } from '../types'
import { dayTime, firstName, liveInvoice } from './labels'

/**
 * An e-visa's Step 4 (docs/decisions/0008-visa-docket-dispatch.md Decision 11), where the Docket card would be: the visa
 * needs no vendor, so it has no docket, sticker or courier. Before: the invoice it needs. After: who submitted it and
 * when, and when it comes back due to check the portal. "Submitted online" itself is the header's button.
 */
export function SubmitOnlineCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const s = c.submittedOnline
  const invoice = liveInvoice(c)

  if (s) {
    return (
      <section className="card pad dispatch-card">
        <h2 className="h2">Submitted online</h2>
        <div>
          <div className="kv">
            <span>Submitted</span>
            <strong>
              {formatDateTime(s.at)}
              {s.by && ` · ${s.by.name}`}
            </strong>
          </div>
          {invoice && (
            <div className="kv">
              <span>Invoice</span>
              <strong>
                <span className="mono">{invoice.invoiceNo}</span> · locked
              </strong>
            </div>
          )}
          {c.stage.code === 'AT_VENDOR' && c.dueAt && (
            <div className="kv">
              <span>
                {dayTime(c.dueAt)}
                {c.owner && ` · ${firstName(c.owner.name)}`}
              </span>
              <strong>Check the portal</strong>
            </div>
          )}
        </div>
      </section>
    )
  }

  if (c.stage.code !== 'DISPATCH' || c.vendorNeeded || c.docket) return null
  const canRaise = !!me && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  return (
    <section className="card pad dispatch-card">
      <h2 className="h2">Submit online</h2>
      <p className="muted small" style={{ margin: 0 }}>
        This visa needs no vendor: no docket, sticker or courier. Once it’s in on the portal, press Submitted online at the
        top.
      </p>
      <div className="kv">
        <span>Invoice</span>
        {invoice ? (
          <span className="chip chip-ok chip-sm">
            <span className="mono">{invoice.invoiceNo}</span> · locked
          </span>
        ) : canRaise ? (
          <button
            type="button"
            className="chip chip-warn chip-sm docket-raise"
            onClick={() => document.getElementById('money')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Raise invoice first →
          </button>
        ) : (
          <span className="chip chip-warn chip-sm">Raise invoice first</span>
        )}
      </div>
    </section>
  )
}
