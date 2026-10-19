import { departmentStyle } from '../../lib/departments'
import '../../styles/notices.css'
import { postedLine, tagLabel } from './labels'
import type { NoticeFeedItem } from './types'

// The lines of a notice feed: Today's notice card and the visa team's login popup (0017 Decisions 11–12).

/**
 * A notice. The chip names its department in a mixed feed (Today), or what it's about where every notice is the same
 * department's (the visa popup: "Embassy · China", as the demo's "China").
 */
export function NoticeLine({ notice, chip = 'department' }: { notice: Extract<NoticeFeedItem, { kind: 'NOTICE' }>; chip?: 'department' | 'tag' }) {
  const style = departmentStyle(notice.department.code)
  return (
    <>
      <span className="feed-meta">
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {chip === 'tag' ? tagLabel(notice) : notice.department.name}
        </span>
        <span className="muted">{postedLine(notice)}</span>
      </span>
      <strong className="feed-title">{notice.title}</strong>
      {notice.body && <span className="feed-body">{notice.body}</span>}
    </>
  )
}

/** A holiday-calendar entry still new, as the demo shows "Tue 20 Oct · Dussehra". */
export function HolidayLine({ holiday }: { holiday: Extract<NoticeFeedItem, { kind: 'HOLIDAY' }> }) {
  return (
    <>
      <span className="feed-meta">
        <span className="chip chip-warn chip-sm">Holiday</span>
        <span className="muted">Holiday calendar{holiday.addedBy ? ` · ${holiday.addedBy.name}` : ''}</span>
      </span>
      <strong className="feed-title">
        {holiday.label} · {holiday.name}
      </strong>
      <span className="feed-body">Applies to {holiday.targets.join(' · ')}.</span>
    </>
  )
}
