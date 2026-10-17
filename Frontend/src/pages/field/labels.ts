import { addDays } from '../../lib/format'
import type { FieldJobKind, RunStop } from './types'

// Wording on the field staff's phone (demo screens 14 and 25 ⚠️).

export const KIND_LABEL: Record<FieldJobKind, string> = { PICKUP: 'Pick up documents', DELIVERY: 'Deliver passports' }
export const FINISHED_LABEL = { DONE: 'Done', FAILED: "Couldn't complete" }

const SHORT_DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Sat 31 Oct" for a day (YYYY-MM-DD). */
export function shortDay(day: string): string {
  const parts = SHORT_DAY.formatToParts(new Date(`${day}T00:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}`
}

/** "Today", "Yesterday" or "Tomorrow" when it's one of those, else "Sat 31 Oct". */
export function dayName(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return shortDay(day)
}

/** "No stops today." or "No stops on Sat 31 Oct." */
export function noStops(day: string, today: string): string {
  const name = dayName(day, today)
  return name === shortDay(day) ? `No stops on ${name}.` : `No stops ${name.toLowerCase()}.`
}

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

/** "3:12 pm", in India time. */
export const timeOf = (iso: string) => TIME.format(new Date(iso)).replace(/\s?am$/i, ' am').replace(/\s?pm$/i, ' pm')

/** "Done · 3:12 pm" or "Couldn't complete · Client not home · 3:12 pm". */
export function finishedText(stop: RunStop): string {
  if (stop.status !== 'DONE' && stop.status !== 'FAILED') return ''
  const at = stop.finishedAt ? timeOf(stop.finishedAt) : null
  return [FINISHED_LABEL[stop.status], stop.failReason, at].filter(Boolean).join(' · ')
}

/** "2 passports + 1 old", "1 passport", "2 old passports". */
export function handOverText({ current, old }: { current: number; old: number }): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (current > 0 && old > 0) return `${count(current, 'passport')} + ${old} old`
  return old > 0 ? count(old, 'old passport') : count(current, 'passport')
}

/** The pending papers, traveller by traveller, in the case's order. */
export function byTraveller(pending: RunStop['pending']) {
  const groups: { traveller: string; documents: string[] }[] = []
  for (const p of pending) {
    const last = groups.at(-1)
    if (last?.traveller === p.traveller) last.documents.push(p.document)
    else groups.push({ traveller: p.traveller, documents: [p.document] })
  }
  return groups
}

/** The office's Google Maps link, else directions to the address (a plain Google Maps link: no key, no cost). */
export const directionsTo = (stop: RunStop) =>
  stop.mapLink ?? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`
