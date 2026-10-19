import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { departmentStyle } from '../../lib/departments'
import { initials } from '../../lib/format'
import { statusNote } from '../enquiries/status'
import { upNextWhen } from './labels'
import type { TodaySummary, UpNextRow } from './types'

/** Rows shown before "Show all": the demo's 7 (Decision 9). */
const FIRST_ROWS = 7

/**
 * Up next (docs/decisions/0017-today-dashboard.md Decision 9, demo screen 01): the cases behind Due today and Running
 * late, late first, then by time due. A row opens the All enquiries list with that case picked and its steps open.
 */
export function UpNextCard({ day }: { day: TodaySummary | undefined }) {
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const rows = day?.upNext.rows ?? []
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  // Staff's rows are all their own; the owner is for an HOD's or the Head's day.
  const showOwner = day?.scope.kind !== 'MINE'
  // A postponed case is on the list's Postponed tab; the others (a cancelled one still to hand back too) on Open.
  const open = (row: UpNextRow) =>
    navigate(row.status === 'POSTPONED' ? '/enquiries?status=postponed' : '/enquiries', { state: { selected: row.id } })

  return (
    <section id="up-next" className="card up-next">
      <div className="up-next-head">
        <div>
          <h2 className="h2">Up next</h2>
          <p className="muted small">Late ones first. Click to open the enquiry.</p>
        </div>
        <Link to="/enquiries" className="btn btn-sm">
          All enquiries
        </Link>
      </div>
      {!day ? (
        <p className="pad muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="pad muted">Nothing due today and nothing late.</p>
      ) : (
        <>
          <ul className="up-next-list">
            {shown.map((row) => (
              <UpNextItem key={row.id} row={row} showOwner={showOwner} onOpen={() => open(row)} />
            ))}
          </ul>
          {rows.length > FIRST_ROWS && (
            <div className="up-next-foot">
              <button type="button" className="btn-link" onClick={() => setAll(!all)}>
                {all ? 'Show fewer' : `Show all ${rows.length}`}
              </button>
              {all && day.upNext.more && <span className="muted small">The first {rows.length} are shown; the rest are in All enquiries.</span>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function UpNextItem({ row, showOwner, onOpen }: { row: UpNextRow; showOwner: boolean; onOpen: () => void }) {
  const style = departmentStyle(row.department.code)
  const when = upNextWhen(row.dueAt)
  return (
    <li>
      <button type="button" className="up-next-row" onClick={onOpen}>
        <span className={`up-next-when is-${when.tone}`}>{when.text}</span>
        <span className="up-next-bar" style={{ background: style.solid }} aria-hidden="true" />
        <span className="up-next-main">
          <span className="up-next-title">{statusNote(row) ?? row.whatFor}</span>
          <span className="up-next-sub">
            {row.client.name} · <span className="mono">{row.caseNo}</span> · {row.summary}
          </span>
        </span>
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {row.department.name}
        </span>
        {showOwner &&
          (row.owner ? (
            <span className="up-next-owner" title={row.owner.name}>
              {initials(row.owner.name)}
            </span>
          ) : (
            <span className="up-next-owner is-none" title="Nobody's yet">
              —
            </span>
          ))}
      </button>
    </li>
  )
}
