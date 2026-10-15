import { useState } from 'react'
import { istToday } from '../../../lib/format'
import { useBlockedDays } from '../../settings/masters/queries'
import { longDate } from './labels'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The furthest ahead a collection date may be, as the server allows (a sanity limit). */
const MAX_DAYS_AHEAD = 366

const utc = (day: string) => new Date(`${day}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => iso(new Date(utc(day).getTime() + n * 86_400_000))

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
 * The expected collection date (demo screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 4): a month of days
 * for one embassy, Monday first. The days it's closed are struck through with the holiday's name (its holidays and the
 * weekly Sunday, from the holiday calendar), and so are today and earlier: none of them can be picked. The server checks
 * the same days again when the date is saved.
 */
export function CollectionCalendar({
  embassyId,
  value,
  onChange,
  disabled = false,
}: {
  embassyId: number | null
  value: string | null
  onChange: (day: string) => void
  disabled?: boolean
}) {
  const today = istToday()
  const latest = addDays(today, MAX_DAYS_AHEAD)
  const [month, setMonth] = useState((value ?? addDays(today, 1)).slice(0, 7))
  const m = monthOf(month)
  const blocked = useBlockedDays(embassyId, m.from, m.to)
  const closed = new Map((blocked.data ?? []).map((d) => [d.date, d.holidays.map((h) => h.name).join(', ')]))

  return (
    <div className="collection-calendar">
      <div className="collection-calendar-head">
        <button
          type="button"
          className="btn btn-sm"
          aria-label="Previous month"
          disabled={month <= today.slice(0, 7)}
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
          const off = disabled || !embassyId || blocked.isPending || day <= today || day > latest || !!holiday
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
      {blocked.isError && <p className="field-error">Couldn’t load the embassy’s holidays. Please try again.</p>}
      <div className="collection-picked">
        <span className="muted small">Expected collection</span>
        <strong>{value ? longDate(value) : 'Pick a day'}</strong>
      </div>
    </div>
  )
}
