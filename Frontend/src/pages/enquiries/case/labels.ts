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

/** The steps the follow-up person owns; processing owns the rest (§12.4). */
export const isFollowUpStep = (c: VisaCase) => c.stage.step <= 2
