import { daysFromToday, istTime } from '../enquiries/due'
import type { TodaySummary } from './types'

// The banner's and the tiles' wording (docs/decisions/0017-today-dashboard.md), in India time.

const IST_LONG = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })
const IST_WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' })
const IST_HOUR = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false })
const AND_LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })

/** "Monday, 19 October": the banner's date line. */
export function longToday(now = new Date()): string {
  const parts = IST_LONG.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')}, ${part('day')} ${part('month')}`
}

export function greetingNow(now = new Date()): string {
  const hour = Number(IST_HOUR.format(now))
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

/**
 * "8 enquiries need someone today and 2 are running late. Start with the late ones." Today's and the late ones are two
 * separate groups, as in the demo.
 */
export function heroLine(dueToday: number, late: number): string {
  const today = `${dueToday} ${dueToday === 1 ? 'enquiry needs' : 'enquiries need'} someone today`
  const lateOnes = `${late} ${late === 1 ? 'is' : 'are'} running late. Start with the late ${late === 1 ? 'one' : 'ones'}.`
  if (dueToday > 0 && late > 0) return `${today} and ${lateOnes}`
  if (dueToday > 0) return `${today}. Nothing is running late.`
  if (late > 0) return `Nothing new is due today, but ${lateOnes}`
  return 'Nothing is due today and nothing is running late.'
}

/** Due today's small line: whose cases these are (0017 Decision 1). */
export function scopeLabel(scope: TodaySummary['scope']): string {
  if (scope.kind === 'ALL') return 'across all departments'
  if (scope.kind === 'DEPARTMENTS') return `in ${AND_LIST.format(scope.departments)}${scope.alsoOwn ? ', plus your own cases' : ''}`
  return 'your cases'
}

/** Running late's small line: how long the oldest has waited. */
export function oldestLabel(oldestLateAt: string | null): string {
  if (!oldestLateAt) return 'nothing late'
  const days = -daysFromToday(oldestLateAt)
  if (days >= 2) return `oldest: ${days} days`
  if (days === 1) return 'oldest: yesterday'
  return `oldest: today, ${istTime(new Date(oldestLateAt))}`
}

/** Up next's "when" (Decision 9): late in red ("2 days late", "Yesterday", "10:00 am"), later today in blue ("3:00 pm"). */
export function upNextWhen(dueAt: string, now = new Date()): { text: string; tone: 'late' | 'today' } {
  const at = new Date(dueAt)
  const late = at.getTime() < now.getTime()
  const days = daysFromToday(dueAt)
  if (late && days <= -2) return { text: `${-days} days late`, tone: 'late' }
  if (late && days === -1) return { text: 'Yesterday', tone: 'late' }
  return { text: istTime(at), tone: late ? 'late' : 'today' }
}

/** New enquiries' small line: "since yesterday, 6:00 pm", or the day's name after a Sunday or a holiday. */
export function newSinceLabel(newSince: string): string {
  const at = new Date(newSince)
  return `since ${daysFromToday(newSince) === -1 ? 'yesterday' : IST_WEEKDAY.format(at)}, ${istTime(at)}`
}
