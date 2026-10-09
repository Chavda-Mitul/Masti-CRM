// API shapes for the system masters (Backend/src/modules/holidays, visaMasters; docs/decisions/0005-system-masters.md).
// Dates are "YYYY-MM-DD" (India); timestamps are ISO strings (UTC).

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

export type HolidayRepeat = 'NONE' | 'WEEKLY'
export type HolidayStatus = 'PENDING' | 'ACTIVE' | 'REMOVED'
export type HolidaySource = 'MANUAL' | 'AI_BOT'
export type HolidayTargetKind = 'ALL_EMBASSIES' | 'COUNTRY' | 'EMBASSY' | 'MASTI_OFFICE'

export interface HolidayTarget {
  kind: HolidayTargetKind
  country?: { id: number; code: string; name: string }
  embassy?: { id: number; code: string; name: string; countryId: number }
  /** "China embassy & visa centres", built by the server. */
  label: string
}

export interface Holiday {
  id: string
  name: string
  repeat: HolidayRepeat
  startDate: string
  endDate: string | null
  /** ISO weekday, 1 = Monday … 7 = Sunday. Weekly only. */
  weekday: number | null
  /** "1 – 7 Oct 2026", "Every Sunday", built by the server. */
  label: string
  targets: HolidayTarget[]
  status: HolidayStatus
  source: HolidaySource
  reference: string | null
  isNew: boolean
  addedBy: { id: string; name: string } | null
  apiClient: { id: string; name: string } | null
  reviewedBy: { id: string; name: string } | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export type HolidayTargetBody =
  | { kind: 'ALL_EMBASSIES' }
  | { kind: 'MASTI_OFFICE' }
  | { kind: 'COUNTRY'; countryId: number }
  | { kind: 'EMBASSY'; embassyId: number }

export interface HolidayBody {
  name: string
  repeat: HolidayRepeat
  startDate: string
  endDate: string | null
  weekday: number | null
  targets: HolidayTargetBody[]
  reference: string | null
  confirmDuplicates?: boolean
}

/** GET /holidays/targets: what the "Applies to" picker offers. */
export interface HolidayTargetOptions {
  kinds: { kind: HolidayTargetKind; label: string }[]
  countries: {
    id: number
    code: string
    name: string
    label: string
    embassies: { id: number; code: string; name: string; city: string }[]
  }[]
}

export interface HolidaySettings {
  newForDays: number
  botEntriesNeedReview: boolean
}

/** 409 DUPLICATE from the holidays API. */
export interface HolidayDuplicate {
  id: string
  name: string
  label: string
  targets: string[]
  status: HolidayStatus
}

/** Which holidays the calendar card lists. */
export type HolidayFilter = 'upcoming' | 'pending' | 'removed'

// ---------------------------------------------------------------------------
// Visa masters
// ---------------------------------------------------------------------------

export interface Country {
  id: number
  code: string
  name: string
  zone: string | null
  sortOrder: number
  isActive: boolean
}

export interface VisaType {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface Embassy {
  id: number
  code: string
  countryId: number
  name: string
  city: string
  sortOrder: number
  isActive: boolean
  country: { id: number; code: string; name: string; zone: string | null }
}

export interface DocumentMaster {
  id: number
  code: string
  name: string
  detail: string | null
  sortOrder: number
  isActive: boolean
}

export interface Offering {
  id: number
  /** "France (Schengen) · Tourist" */
  label: string
  country: { id: number; code: string; name: string; zone: string | null; isActive: boolean }
  visaType: { id: number; code: string; name: string; isActive: boolean }
  isActive: boolean
  checklistCount?: number
  updatedAt: string
}

export type DocumentRequirement = 'ORIGINAL' | 'XEROX_OK' | 'ARRANGED_BY_US'
export type TravellerGroup = 'ALL' | 'ADULTS' | 'CHILDREN'

export interface ChecklistItem {
  id: number
  document: { id: number; code: string; name: string; detail: string | null; isActive: boolean }
  requirement: DocumentRequirement
  appliesTo: TravellerGroup
  quantity: number
  note: string | null
  sortOrder: number
}

export interface Checklist {
  offering: {
    id: number
    label: string
    country: { id: number; code: string; name: string; zone: string | null; isActive: boolean; label: string }
    visaType: { id: number; code: string; name: string; isActive: boolean }
    isActive: boolean
    updatedAt: string
  }
  items: ChecklistItem[]
  adults: { count: number }
  children: { count: number }
}

export interface ChecklistLineBody {
  documentId: number
  requirement: DocumentRequirement
  appliesTo: TravellerGroup
  quantity: number
  note: string | null
}

/** The four small lists, by their API path. */
export type MasterResource = 'countries' | 'visa-types' | 'embassies' | 'documents'
