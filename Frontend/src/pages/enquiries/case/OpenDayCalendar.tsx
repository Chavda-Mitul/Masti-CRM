import { useState } from 'react'
import { lostAccess } from '../../../lib/apiErrors'
import { addDays, istToday } from '../../../lib/format'
import { useBlockedDays } from '../../settings/masters/queries'
import type { BlockTarget } from '../../settings/masters/types'
import { longDate } from './labels'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The furthest ahead a day may be, as the server allows (a sanity limit). */
const MAX_DAYS_AHEAD = 366

const utc = (day: string) => new Date(`${day}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** "2026-10": its first and last day, its length, and how many cells to leave before the 1st (Monday first). */
function monthOf(ym: string) {
  const first = utc(`${ym}-01`)
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
  return { from: iso(first), to: iso(last), length: last.getUTCDate(), lead: (first.getUTCDay() + 6) % 7, label: MONTH.format(first) }
}

function shiftMonth(ym: string, by: number) {
  const first = utc(`${ym}-01`)
  return iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + by, 1))).slice(0, 7)
}

/**
 * A month of days, Monday first, to pick one that an embassy or our office is open: the expected collection date (demo
 * screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 4) and the day passports are expected back
 * (docs/decisions/0013-visa-passport-back.md Decision 3). The days it's closed are struck through with the holiday's
 * name (its holidays and the weekly Sunday, from the holiday calendar), and so are the days before the first one allowed
 * (tomorrow, or today with `allowToday`) and the days up to `after` (for the collection date, the latest embassy
 * appointment, decided 16 Oct 2026): none of them can be picked. The server checks the same days again when the date
 * is saved.
 */
export function OpenDayCalendar({
  target,
  label,
  value,
  onChange,
  allowToday = false,
  after = null,
  disabled = false,
}: {
  /** Whose closed days to strike out; nothing can be picked until it's known */
  target: BlockTarget | null
  /** What the picked day is, under the month: "Expected collection" */
  label: string
  value: string | null
  onChange: (day: string) => void
  allowToday?: boolean
  /** Only days after this one can be picked, when it's later than the first day allowed. */
  after?: string | null
  disabled?: boolean
}) {
  const today = istToday()
  const soonest = allowToday ? today : addDays(today, 1)
  const first = after && after >= soonest ? addDays(after, 1) : soonest
  const latest = addDays(today, MAX_DAYS_AHEAD)
  const [month, setMonth] = useState((value ?? first).slice(0, 7))
  const m = monthOf(month)
  const blocked = useBlockedDays(target, m.from, m.to)
  const closed = new Map((blocked.data ?? []).map((d) => [d.date, d.holidays.map((h) => h.name).join(', ')]))

  return (
    <div className="collection-calendar">
      <div className="collection-calendar-head">
        <button
          type="button"
          className="btn btn-sm"
          aria-label="Previous month"
          disabled={month <= first.slice(0, 7)}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ‹
        </button>
        <strong>{m.label}</strong>
        <button
          type="button"
          className="btn btn-sm"
          aria-label="Next month"
          disabled={month >= latest.slice(0, 7)}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          ›
        </button>
      </div>
      <div className="collection-grid" role="grid" aria-label={m.label}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="collection-weekday">
            {w}
          </span>
        ))}
        {Array.from({ length: m.lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: m.length }, (_, i) => {
          const day = addDays(m.from, i)
          const holiday = closed.get(day)
          const off = disabled || !target || blocked.isPending || day < first || day > latest || !!holiday
          const picked = day === value
          return (
            <button
              key={day}
              type="button"
              className={`collection-day${holiday ? ' is-holiday' : ''}${picked ? ' is-picked' : ''}`}
              disabled={off}
              aria-pressed={picked}
              title={holiday ? `${holiday}: closed` : undefined}
              onClick={() => onChange(day)}
            >
              <span className="collection-day-no">{i + 1}</span>
              {holiday && <span className="collection-day-tag">{holiday}</span>}
            </button>
          )
        })}
      </div>
      {(blocked.isLoadingError || lostAccess(blocked)) && <p className="field-error">Couldn’t load the holidays. Please try again.</p>}
      <div className="collection-picked">
        <span className="muted small">{label}</span>
        <strong>{value ? longDate(value) : 'Pick a day'}</strong>
      </div>
    </div>
  )
}
