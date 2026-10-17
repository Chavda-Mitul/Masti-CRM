import { Link } from 'react-router'
import { departmentStyle } from '../../lib/departments'
import { formatMobile } from '../../lib/format'
import { firstName } from '../enquiries/case/labels'
import { byTraveller, directionsTo, finishedText, handOverText, KIND_LABEL } from './labels'
import type { RunStop } from './types'

/**
 * One stop (demo screen 14): when, what, whose, where; while it's booked, Call and Directions and what to hand over or
 * collect; once finished, how it ended. `number`: its place on the run (none for a called-off stop); `now`: the one he's
 * on; `record`: link to the stop's own screen, where he records it (today's booked stops on the run).
 */
export function StopCard({ stop, number, now = false, record = false }: { stop: RunStop; number: number | null; now?: boolean; record?: boolean }) {
  const department = departmentStyle(stop.department)
  const label = [number === null ? null : `Stop ${number}`, stop.slot.name, now ? 'Now' : null].filter(Boolean).join(' · ')
  const client = firstName(stop.client.name)
  const cancelled = stop.status === 'CANCELLED'

  return (
    <article className={`card field-stop${cancelled ? ' is-cancelled' : ''}${now ? ' is-now' : ''}`}>
      <div className="field-stop-top">
        <span className="lbl">{label}</span>
        <span className="chip chip-sm" style={{ background: department.tint, color: department.text }}>
          {KIND_LABEL[stop.kind]}
        </span>
      </div>
      <div>
        <h2 className="field-client">
          {stop.client.name} · {stop.caseNo}
        </h2>
        <p className="field-address">{stop.address}</p>
      </div>

      {stop.status === 'CANCELLED' ? (
        <p className="field-called-off">Called off by the office. Don&apos;t go.</p>
      ) : (
        <>
          {stop.status === 'BOOKED' ? (
            <div className="field-actions">
              <a className="btn" href={`tel:${stop.mobile}`} aria-label={`Call ${client} on ${formatMobile(stop.mobile)}`}>
                Call {client}
              </a>
              <a className="btn" href={directionsTo(stop)} target="_blank" rel="noreferrer">
                Directions
              </a>
            </div>
          ) : (
            <span className={`chip field-finished ${stop.status === 'DONE' ? 'chip-ok' : 'chip-bad'}`}>{finishedText(stop)}</span>
          )}
          {stop.status === 'BOOKED' && stop.kind === 'DELIVERY' && stop.booklets && (
            <div className="field-need">
              <span>Hand over</span>
              <strong>{handOverText(stop.booklets)}</strong>
            </div>
          )}
          {stop.status === 'BOOKED' && stop.kind === 'PICKUP' && <StillToCollect pending={stop.pending} />}
          {record && stop.status === 'BOOKED' && (
            <Link to={`/tasks/${stop.id}`} className="btn btn-primary field-record">
              Record this stop ›
            </Link>
          )}
        </>
      )}
    </article>
  )
}

/** A pickup's papers still pending on the case's checklist, traveller by traveller (names only, nothing scanned). */
function StillToCollect({ pending }: { pending: RunStop['pending'] }) {
  const groups = byTraveller(pending)
  return (
    <div className="field-need field-collect">
      <span>Still to collect</span>
      {groups.length === 0 ? (
        <span className="muted">Nothing pending on the checklist</span>
      ) : (
        <ul>
          {groups.map((g, i) => (
            <li key={`${i}-${g.traveller}`}>
              {/* Not commas: checklist names hold them ("Bank statement, last 6 months"). */}
              <strong>{g.traveller}:</strong> {g.documents.join(' · ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
