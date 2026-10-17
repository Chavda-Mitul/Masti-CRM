import { useState } from 'react'
import { canActOnCase, canHandOver } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import type { VisaCase } from '../types'
import { FieldJobLines } from './FieldJobLines'
import { HandoverDialog } from './HandoverDialog'
import {
  bookletsSent,
  bookletsText,
  bookletsVsIntake,
  dayTime,
  firstName,
  heldShort,
  missingCount,
  passportsInStock,
  passportsMissing,
  weekdayDay,
  windingDown,
} from './labels'
import { PassportsBackDialog } from './PassportsBackDialog'
import { ReceivePassportsDialog } from './ReceivePassportsDialog'
import { ShortfallDialog } from './ShortfallDialog'

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
 * due back. While they're in transit, whoever can act on the case corrects either day (Change, open or cancelled cases:
 * 0006 amendment 15) or marks them received (any status: the packet is here). Once received: the booklets counted
 * against intake, the stickers checked and who received them, red where they don't match. A short return holds the
 * handover and the delivery boy until whoever can act on the case settles it (0013 Decision 5, amended 17 Oct 2026): it
 * came, or it won't come back.
 */
export function PassportsBackCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [changing, setChanging] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [handing, setHanding] = useState(false)
  const [settling, setSettling] = useState(false)
  const p = c.passportsBack
  if (!p) return null
  const r = c.passportsReceived
  const canAct = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const inTransit = c.stage.code === 'PASSPORT_BACK' && !r
  // In our stock: whoever is at the desk hands them over, whatever the case's status (0014 Decisions 5 and 7).
  // Not while a short return holds them (0013 Decision 5, amended 17 Oct 2026).
  const held = heldShort(c)
  const canHand = !!me && !held && canHandOver(me, { department: c.department.code, inStock: passportsInStock(c) })
  const cleared = r?.shortfallCleared
  const booklets = r && bookletsVsIntake(r.booklets, bookletsSent(c))
  const stickers = r && stickersSummary(c)
  // A cancelled case's passports still come back, and it stays due until handed back (0006 amendment 15).
  const live = c.status === 'OPEN' || windingDown(c)

  return (
    <section className="card pad passports-back-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h2 className="h2">Passports coming back</h2>
        {inTransit && canAct && (
          <span style={{ display: 'flex', gap: 8 }}>
            {live && (
              <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>
                Change
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setReceiving(true)}>
              Mark received
            </button>
          </span>
        )}
        {canHand && (
          <button type="button" className="btn btn-sm" onClick={() => setHanding(true)}>
            Hand over
          </button>
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
      {r && missingCount(c) > 0 && (
        <div className={`alert ${cleared ? 'alert-warn' : 'alert-bad'} return-missing`} role="status">
          {cleared ? (
            <span>
              {passportsMissing(r.missing)} missing · cleared by {cleared.by?.name ?? '—'}, {dayTime(cleared.at)}: {cleared.reason}
            </span>
          ) : (
            <span>
              <strong>{passportsMissing(r.missing)} missing.</strong> The handover waits until {missingCount(c) === 1 ? 'it comes' : 'they come'} or the
              shortfall is cleared.
            </span>
          )}
          {canAct && passportsInStock(c) && (
            <button type="button" className="btn btn-sm" onClick={() => setSettling(true)}>
              {cleared ? 'It came back…' : missingCount(c) === 1 ? 'Missing passport…' : 'Missing passports…'}
            </button>
          )}
        </div>
      )}
      {/* In our stock: the delivery boy, booked by whoever can hand over (0015 phase 2). */}
      {r && c.stage.code === 'PASSPORT_BACK' && !c.handover && <FieldJobLines visaCase={c} kind="DELIVERY" canBook={canHand} />}
      {c.stage.code === 'PASSPORT_BACK' && live && c.dueAt && (
        <div className="kv">
          <span>
            {dayTime(c.dueAt)}
            {c.owner && ` · ${firstName(c.owner.name)}`}
          </span>
          <strong>
            {!r ? 'Check the passports have arrived' : !held ? 'Arrange the handover' : missingCount(c) === 1 ? 'Find the missing passport' : 'Find the missing passports'}
          </strong>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        A passport counts as ours only once the packet is opened and punched at the office.
      </p>
      {changing && <PassportsBackDialog visaCase={c} onClose={() => setChanging(false)} />}
      {receiving && <ReceivePassportsDialog visaCase={c} onClose={() => setReceiving(false)} />}
      {handing && <HandoverDialog visaCase={c} onClose={() => setHanding(false)} />}
      {settling && <ShortfallDialog visaCase={c} onClose={() => setSettling(false)} />}
    </section>
  )
}
