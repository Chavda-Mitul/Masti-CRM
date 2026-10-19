import { Link } from 'react-router'
import { departmentStyle } from '../../lib/departments'
import { postedLine } from '../notices/labels'
import type { TodayNotice, TodaySummary } from './types'

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
        <ul className="today-notice-list">
          {day.notices.map((n) => (
            <li key={`${n.kind}-${n.id}`}>{n.kind === 'NOTICE' ? <NoticeLine notice={n} /> : <HolidayLine holiday={n} />}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NoticeLine({ notice }: { notice: Extract<TodayNotice, { kind: 'NOTICE' }> }) {
  const style = departmentStyle(notice.department.code)
  return (
    <>
      <span className="today-notice-meta">
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {notice.department.name}
        </span>
        <span className="muted">{postedLine(notice)}</span>
      </span>
      <strong className="today-notice-title">{notice.title}</strong>
      {notice.body && <span className="today-notice-body">{notice.body}</span>}
    </>
  )
}

/** A new holiday-calendar entry, as the demo shows "Tue 20 Oct · Dussehra". */
function HolidayLine({ holiday }: { holiday: Extract<TodayNotice, { kind: 'HOLIDAY' }> }) {
  return (
    <>
      <span className="today-notice-meta">
        <span className="chip chip-warn chip-sm">Holiday</span>
        <span className="muted">Holiday calendar{holiday.addedBy ? ` · ${holiday.addedBy.name}` : ''}</span>
      </span>
      <strong className="today-notice-title">
        {holiday.label} · {holiday.name}
      </strong>
      <span className="today-notice-body">Applies to {holiday.targets.join(' · ')}.</span>
    </>
  )
}
