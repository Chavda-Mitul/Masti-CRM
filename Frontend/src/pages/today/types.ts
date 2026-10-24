import type { EnquiryStatus, PersonRef } from '../enquiries/types'
import type { NoticeFeedItem } from '../notices/types'

// The Today page (docs/decisions/0017-today-dashboard.md): GET /api/today.

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
  /** Documents complete and gone to processing: nobody's yet, it waits for a processor (else for an owner). */
  matured: boolean
  owner: PersonRef | null
  dueAt: string
}

/** Current and old passport booklets. */
export interface Booklets {
  current: number
  old: number
}

/**
 * The passport booklets we hold, office-wide (amendment 3): in our office, with the vendors, on the way back, and
 * missing from short returns (not yet found or cleared).
 */
export interface PassportStock {
  inOffice: Booklets
  withVendors: Booklets
  onTheWayBack: Booklets
  missing: Booklets
}

/** One person's day: the banner's sentence and the tiles. */
export interface TodaySummary {
  /** Whose cases: everyone's (the Head), whole departments (an HOD, with their names), or the person's own. */
  /** alsoOwn: an HOD who also counts their own cases in departments they don't lead. */
  scope: { kind: TodayScopeKind; departments: string[]; alsoOwn: boolean }
  dueToday: number
  late: number
  oldestLateAt: string | null
  newEnquiries: number
  /** Where New enquiries start: the cut-off time on the previous office day. */
  newSince: string
  /** The cases behind Due today and Running late, at most 200 (more: there are others). */
  upNext: { rows: UpNextRow[]; more: boolean }
  /** Each department the person can see: its cases on the list's Open tab (Decision 10). mine: only their own. */
  openByDepartment: { code: string; name: string; count: number; mine: boolean }[]
  /** The notice card (Decision 11): the latest 3 of their departments' notices and the holiday entries still new. */
  notices: NoticeFeedItem[]
  /**
   * Business lost this month (Decision 5, amendment 2): the cases that came in this month, booked (a standing invoice),
   * lost (cancelled) or still open, which add up to queriesIn; and the top 3 reasons they were lost, most first.
   */
  businessLost: { queriesIn: number; booked: number; lost: number; stillOpen: number; reasons: { name: string; count: number }[] }
  /** The passport booklets we hold (amendment 3): for the Head and the Visa HOD only, null for everyone else. */
  passportStock: PassportStock | null
}
