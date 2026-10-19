import { Link } from 'react-router'
import { HolidayLine, NoticeLine } from '../notices/NoticeLines'
import type { TodaySummary } from './types'

/**
 * The notice board on Today (docs/decisions/0017-today-dashboard.md Decision 11, demo screen 01): the latest 3 of the
 * person's departments' notices and the holiday-calendar entries still marked new. All notices opens the board.
 */
export function NoticeBoardCard({ day }: { day: TodaySummary | undefined }) {
  return (
    <section className="card pad today-notices">
      <div className="today-card-head">
        <h2 className="h2">Notice board</h2>
        <Link to="/notices" className="btn btn-sm">
          All notices
        </Link>
      </div>
      {!day ? (
        <p className="muted">Loading…</p>
      ) : day.notices.length === 0 ? (
        <p className="muted small">
          No notices yet. <Link to="/notices">Open the board</Link>
        </p>
      ) : (
        <ul className="notice-feed">
          {day.notices.map((n) => (
            <li key={`${n.kind}-${n.id}`}>{n.kind === 'NOTICE' ? <NoticeLine notice={n} /> : <HolidayLine holiday={n} />}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
