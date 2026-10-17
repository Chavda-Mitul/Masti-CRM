import { canSeeEnquiry } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { useOpenCaseFile } from '../queries'
import type { VisaCase } from '../types'
import { bookletsText, dayTime, firstName } from './labels'

/**
 * "Handed back to the client" (demo screen 13 ⚠️, docs/decisions/0014-visa-delivered.md), once delivered: when, how
 * (collected at the office; the delivery boy comes later), the booklets handed over, who collected them, their photo,
 * and who handed them over. The photo opens for whoever can still open the case; desk staff who handed it over can't
 * once it's delivered (0014 Decision 5), so they see "Saved", as the demo. The demo's cross-sell card comes with the
 * cross-sell module.
 */
export function HandoverCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const openFile = useOpenCaseFile(c.caseNo)
  const h = c.handover
  if (!h) return null
  const photo = h.photo
  const canOpen = !!me && canSeeEnquiry(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad handover-card">
      <div className="handover-card-head">
        <h2 className="h2">Handed back to the client</h2>
        {/* Handed back before dispatch, the case stays at its step (0006 amendment 15): "Handed back", not "Delivered". */}
        <span className="chip chip-ok">
          {c.stage.code === 'DELIVERED' ? 'Delivered' : 'Handed back'} · {dayTime(h.at)}
        </span>
      </div>
      <span className="seg-btn" aria-label="How the passports went back">
        <button type="button" className={h.mode === 'OFFICE' ? 'on' : ''} disabled>
          Client collects from office
        </button>
        <button type="button" className={h.mode === 'DELIVERY' ? 'on' : ''} disabled>
          Our delivery boy
        </button>
      </span>
      <div className="return-tiles handover-tiles">
        <div className="return-tile done">
          <span className="small">Booklets</span>
          <strong>{bookletsText(h.booklets)} — matches our stock</strong>
        </div>
        <div className="return-tile">
          <span className="small">Collected by</span>
          <strong>{h.receiver.name}</strong>
        </div>
        <div className="return-tile">
          <span className="small">Photo of receiver</span>
          {photo && canOpen ? (
            <button type="button" className="btn-link" onClick={() => openFile(photo.id)}>
              Open
            </button>
          ) : (
            <strong>{photo ? 'Saved' : '—'}</strong>
          )}
        </div>
        <div className="return-tile">
          <span className="small">Handed over by</span>
          <strong>{h.by ? firstName(h.by.name) : '—'}</strong>
        </div>
      </div>
    </section>
  )
}
