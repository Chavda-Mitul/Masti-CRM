import type { VisaCase } from '../types'
import { dayTime, firstName, weekdayDay } from './labels'

/**
 * "With the vendor" (demo screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 2), beside the Dispatch card once
 * the docket is dispatched: when it was dispatched, when the vendor got it and checked the papers, and (component 2) when
 * it was submitted at the embassy with the vendor's file number. While the file waits, what's due next and when.
 * "Vendor got it" itself is the header's button.
 */
export function WithVendorCard({ visaCase: c }: { visaCase: VisaCase }) {
  const d = c.docket
  if (d?.status !== 'DISPATCHED') return null
  const got = c.vendorReceived

  return (
    <section className="card pad dispatch-card">
      <h2 className="h2">With the vendor</h2>
      <div>
        <div className="kv">
          <span>
            Dispatched in <span className="mono">{d.docketNo}</span>
          </span>
          {d.dispatchedAt && <span className="chip chip-ok chip-sm">{weekdayDay(d.dispatchedAt)}</span>}
        </div>
        <div className="kv">
          <span>Vendor got it, papers checked</span>
          {got ? <span className="chip chip-ok chip-sm">{weekdayDay(got.at)}</span> : <span className="chip chip-warn chip-sm">Waiting</span>}
        </div>
        <div className="kv">
          <span>Submitted at the embassy</span>
          <span className="muted">—</span>
        </div>
        <div className="kv">
          <span>File number from vendor</span>
          <span className="muted">—</span>
        </div>
        {c.stage.code === 'AT_VENDOR' && c.status === 'OPEN' && c.dueAt && (
          <div className="kv">
            <span>
              {dayTime(c.dueAt)}
              {c.owner && ` · ${firstName(c.owner.name)}`}
            </span>
            <strong>{got ? 'Get the file number' : 'Confirm vendor got it'}</strong>
          </div>
        )}
      </div>
    </section>
  )
}
