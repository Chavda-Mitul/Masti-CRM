import { istToday } from '../../lib/format'

// The "Due" column (§9): late in red, today in blue, later in grey. All in India time.

export type DueTone = 'late' | 'today' | 'later'

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
const IST_WEEKDAY_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })

const time = (d: Date) => IST_TIME.format(d).replace(/\s?am$/i, ' am').replace(/\s?pm$/i, ' pm')
const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000

/** "Late · 2 days", "Late · yesterday", "Today, 11:00 am", "Tomorrow, 11:00 am", "Tue 6 Oct". */
export function dueOf(iso: string | null, now = new Date()): { text: string; tone: DueTone } {
  if (!iso) return { text: '—', tone: 'later' }
  const due = new Date(iso)
  const days = dayNumber(IST_DAY.format(due)) - dayNumber(istToday())
  if (due.getTime() < now.getTime()) {
    if (days === 0) return { text: `Late · ${time(due)}`, tone: 'late' }
    if (days === -1) return { text: 'Late · yesterday', tone: 'late' }
    return { text: `Late · ${-days} days`, tone: 'late' }
  }
  if (days === 0) return { text: `Today, ${time(due)}`, tone: 'today' }
  if (days === 1) return { text: `Tomorrow, ${time(due)}`, tone: 'later' }
  return { text: IST_WEEKDAY_DATE.format(due).replace(',', ''), tone: 'later' }
}
