import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import type { VisaCase } from '../types'
import { bookletsSent, bookletsText, bookletsVsIntake, dayTime, firstName, weekdayDay } from './labels'
import { PassportsBackDialog } from './PassportsBackDialog'
import { ReceivePassportsDialog } from './ReceivePassportsDialog'

/** What the stickers box says once received (0013 Decision 5), and whether it's a problem. */
function stickersSummary(c: VisaCase): { text: string; bad: boolean } {
  if (c.recall) return { text: 'No stickers (taken back)', bad: false }
  const approved = c.travellers.filter((t) => t.decision?.outcome === 'APPROVED')
  if (approved.length === 0) return { text: 'No stickers (all refused)', bad: false }
  const wrong = approved.filter((t) => t.stickerCheck === 'MISMATCH').map((t) => t.name ?? t.label)
  return wrong.length === 0 ? { text: 'All match names & dates', bad: false } : { text: `Doesn’t match: ${wrong.join(', ')}`, bad: true }
}

/**
 * "Passports coming back" (demo screen 12 ⚠️, docs/decisions/0013-visa-passport-back.md Decisions 2 and 5), once they're
 * on their way: the demo's three tiles, Vendor collected → In transit to us → In our passport stock, and when the case is
 * due back. While they're in transit, whoever can act on the case corrects either day (Change, open cases only) or marks
 * them received (any status: the packet is here). Once received: the booklets counted against intake, the stickers
 * checked and who received them, red where they don't match.
 */
export function PassportsBackCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [changing, setChanging] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const p = c.passportsBack
  if (!p) return null
  const r = c.passportsReceived
  const canAct = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const inTransit = c.stage.code === 'PASSPORT_BACK' && !r
  const booklets = r && bookletsVsIntake(r.booklets, bookletsSent(c))
  const stickers = r && stickersSummary(c)

  return (
    <section className="card pad passports-back-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h2 className="h2">Passports coming back</h2>
        {inTransit && canAct && (
          <span style={{ display: 'flex', gap: 8 }}>
            {c.status === 'OPEN' && (
              <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>
                Change
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setReceiving(true)}>
              Mark received
            </button>
          </span>
        )}
      </div>
      <div className="return-tiles">
        <div className="return-tile done">
          <span className="small">Done · {weekdayDay(p.collectedOn)}</span>
          <strong>Vendor collected</strong>
        </div>
        <div className={`return-tile ${r ? 'done' : 'now'}`}>
          <span className="small">
            {r ? 'Done' : 'Now'} · expected {weekdayDay(p.expectedOn)}
          </span>
          <strong>In transit to us</strong>
        </div>
        <div className={`return-tile${r ? ' now' : ''}`}>
          <span className="small">{r ? `Now · ${dayTime(r.at)}` : 'Not yet'}</span>
          <strong>In our passport stock</strong>
        </div>
      </div>
      {r && booklets && stickers && (
        <div className="return-fields">
          <div>
            <strong className="small">Booklets counted</strong>
            <div className={`return-field${booklets.matches ? '' : ' is-bad'}`}>
              {bookletsText(r.booklets)} — {booklets.text}
            </div>
          </div>
          <div>
            <strong className="small">Visa stickers checked</strong>
            <div className={`return-field${stickers.bad ? ' is-bad' : ''}`}>{stickers.text}</div>
          </div>
          <div>
            <strong className="small">Received by</strong>
            <div className="return-field">{r.by?.name ?? '—'}</div>
          </div>
        </div>
      )}
      {c.stage.code === 'PASSPORT_BACK' && c.status === 'OPEN' && c.dueAt && (
        <div className="kv">
          <span>
            {dayTime(c.dueAt)}
            {c.owner && ` · ${firstName(c.owner.name)}`}
          </span>
          <strong>{r ? 'Arrange the handover' : 'Check the passports have arrived'}</strong>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        A passport counts as ours only once the packet is opened and punched at the office.
      </p>
      {changing && <PassportsBackDialog visaCase={c} onClose={() => setChanging(false)} />}
      {receiving && <ReceivePassportsDialog visaCase={c} onClose={() => setReceiving(false)} />}
    </section>
  )
}
