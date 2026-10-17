import type { CaseTraveller, DocumentRequirement, VisaCase } from '../types'

// Wording shared by the case page's cards (demo screen 07 ⚠️).

export const REQUIREMENT_LABEL: Record<DocumentRequirement, string> = {
  ORIGINAL: 'Original',
  XEROX_OK: 'Xerox is fine',
  ARRANGED_BY_US: 'Arranged by us',
}

const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/** "28 Sep", in India time. */
export function dayMonth(iso: string): string {
  return DAY_MONTH.format(new Date(iso))
}

const DAY_TIME = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
})

/** "Thu 15 Oct, 11:00", in India time: when a case comes back due (the demo's "Tomorrow 11:00"). */
export function dayTime(iso: string): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => DAY_TIME.formatToParts(new Date(iso)).find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`
}

/** "Wed 7 Oct", in India time: when a step happened (the timeline on demo screen 10). */
export function weekdayDay(iso: string): string {
  const parts = DAY_TIME.formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}`
}

const LONG_DATE = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "Tue, 27 October 2026" for a day (YYYY-MM-DD), such as the expected collection date. */
export function longDate(day: string): string {
  return LONG_DATE.format(new Date(`${day}T00:00:00Z`))
}

/** "4 current + 3 old". Booklets are optional at intake (e-visas hand over none), so a blank count shows as 0. */
export const bookletsText = (b: { current: number | null; old: number | null }) => `${b.current ?? 0} current + ${b.old ?? 0} old`

/**
 * What went to the vendor, as the docket counted it (0008 Decision 4): the current booklets counted at intake, else
 * one per traveller, and the old ones. Receipt counts are compared with it (0013 Decision 5).
 */
export const bookletsSent = (c: VisaCase) => ({ current: c.booklets.current ?? c.travellers.length, old: c.booklets.old ?? 0 })

/** How a count at receipt compares with intake (0013 Decision 5) ⚠️: "matches intake", or "1 old short of intake". */
export function bookletsVsIntake(counted: { current: number; old: number }, sent: { current: number; old: number }) {
  const part = (diff: number, what: string) => (diff < 0 ? `${-diff} ${what} short` : `${diff} ${what} extra`)
  const parts = [
    counted.current !== sent.current && part(counted.current - sent.current, 'current'),
    counted.old !== sent.old && part(counted.old - sent.old, 'old'),
  ].filter((p): p is string => !!p)
  return parts.length === 0 ? { matches: true, text: 'matches intake' } : { matches: false, text: `${parts.join(', ')} of intake` }
}

/** "7 passports + 3 old": old passports go in the parcel too (0008 Decision 4). */
export function passportTotal(current: number, old: number): string {
  const label = `${current} ${current === 1 ? 'passport' : 'passports'}`
  return old > 0 ? `${label} + ${old} old` : label
}

/** "Rakesh" from "RAKESH MEHTA": the tab and tile label. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

/** "Rakesh · adult", "Aarav · child, 12", or the placeholder "Adult 1" until the traveller is named. */
export function travellerTab(t: CaseTraveller): { name: string; detail: string | null } {
  if (!t.name) return { name: t.label, detail: null }
  const age = t.member?.age
  return { name: firstName(t.name), detail: t.isChild ? `child${age != null ? `, ${age}` : ''}` : 'adult' }
}

/** The passports are in our stock: received at Step 7, not yet handed over (0014 Decision 5). */
export const passportsInStock = (c: VisaCase) => c.stage.code === 'PASSPORT_BACK' && !!c.passportsReceived && !c.handover

/** The steps the follow-up person owns; processing owns the rest (§12.4). */
export const isFollowUpStep = (c: VisaCase) => c.stage.step <= 2

/** The case's invoice while it stands; null when there's none, or a credit note cancelled it (0011 Decision 5). */
export const liveInvoice = (c: VisaCase) => (c.invoice && !c.invoice.cancelled ? c.invoice : null)
