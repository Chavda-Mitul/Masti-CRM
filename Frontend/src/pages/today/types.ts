// The Today page (docs/decisions/0017-today-dashboard.md): GET /api/today and the "today" setting.

export type TodayScopeKind = 'ALL' | 'DEPARTMENTS' | 'MINE'

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
}

export interface TodaySettings {
  /** "HH:mm": New enquiries count from this time on the previous office day. */
  newSinceAt: string
}
