import type { EnquiryStatus, PersonRef } from '../enquiries/types'

// The Today page (docs/decisions/0017-today-dashboard.md): GET /api/today and the "today" setting.

export type TodayScopeKind = 'ALL' | 'DEPARTMENTS' | 'MINE'

/** A case on Up next (Decision 9): late or due before midnight, late first, then by time due. */
export interface UpNextRow {
  id: string
  caseNo: string
  department: { code: string; name: string }
  client: { id: string; name: string }
  /** "France (Schengen) · Tourist · 2 adults, 2 children" */
  summary: string
  status: EnquiryStatus
  reason: { name: string } | null
  /** When a postponed case comes back, YYYY-MM-DD. */
  resumeOn: string | null
  /** A cancelled visa case whose passports are still to hand back. */
  toHandBack: boolean
  /** "8 of 11 documents pending", or the case's next step. */
  whatFor: string
  owner: PersonRef | null
  dueAt: string
}

/** One person's day: the banner's sentence and the tiles. */
export interface TodaySummary {
  /** Whose cases: everyone's (the Head), whole departments (an HOD, with their names), or the person's own. */
  scope: { kind: TodayScopeKind; departments: string[] }
  dueToday: number
  late: number
  oldestLateAt: string | null
  newEnquiries: number
  /** Where New enquiries start: the cut-off time on the previous office day. */
  newSince: string
  /** The cases behind Due today and Running late, at most 200 (more: there are others). */
  upNext: { rows: UpNextRow[]; more: boolean }
}

export interface TodaySettings {
  /** "HH:mm": New enquiries count from this time on the previous office day. */
  newSinceAt: string
}
