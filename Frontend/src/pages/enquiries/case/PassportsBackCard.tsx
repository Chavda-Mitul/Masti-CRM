import type { VisaCase } from '../types'
import { dayTime, firstName, weekdayDay } from './labels'

/**
 * "Passports coming back" (demo screen 12 ⚠️, docs/decisions/0013-visa-passport-back.md Decision 2), once they're on
 * their way: the demo's three tiles, Vendor collected → In transit to us → In our passport stock, and when the case is
 * due back to check they've arrived. "Mark received" comes with component 3.
 */
export function PassportsBackCard({ visaCase: c }: { visaCase: VisaCase }) {
  const p = c.passportsBack
  if (!p) return null

  return (
    <section className="card pad passports-back-card">
      <h2 className="h2">Passports coming back</h2>
      <div className="return-tiles">
        <div className="return-tile done">
          <span className="small">Done · {weekdayDay(p.collectedOn)}</span>
          <strong>Vendor collected</strong>
        </div>
        <div className="return-tile now">
          <span className="small">Now · expected {weekdayDay(p.expectedOn)}</span>
          <strong>In transit to us</strong>
        </div>
        <div className="return-tile">
          <span className="small">Not yet</span>
          <strong>In our passport stock</strong>
        </div>
      </div>
      {c.stage.code === 'PASSPORT_BACK' && c.status === 'OPEN' && c.dueAt && (
        <div className="kv">
          <span>
            {dayTime(c.dueAt)}
            {c.owner && ` · ${firstName(c.owner.name)}`}
          </span>
          <strong>Check the passports have arrived</strong>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        A passport counts as ours only once the packet is opened and punched at the office.
      </p>
    </section>
  )
}
