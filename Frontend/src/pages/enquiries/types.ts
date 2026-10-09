// API shapes for the enquiry screens. Mirrors Backend/src/modules/enquiries and Backend/src/modules/visa.

export type EnquiryStatus = 'OPEN' | 'POSTPONED' | 'CANCELLED' | 'LOST' | 'CLOSED'
export type EnquiryOrigin = 'STAFF' | 'WHATSAPP_BOT' | 'WEBSITE_FORM' | 'CROSS_SELL' | 'IMPORT'

export interface StageRef {
  code: string
  name: string
  /** 1, 2, 3… */
  step: number
  of: number
  statusLabel: string
  nextStepLabel: string
}

export interface PersonRef {
  id: string
  name: string
}

export interface EnquiryRow {
  id: string
  caseNo: string
  department: { code: string; name: string }
  client: { id: string; name: string; mobile: string }
  /** "France (Schengen) · Tourist · 2 adults, 2 children" */
  summary: string
  status: EnquiryStatus
  stage: StageRef
  source: { code: string; name: string }
  origin: EnquiryOrigin
  owner: PersonRef | null
  dueAt: string | null
  createdAt: string
}

export interface DepartmentChip {
  code: string
  name: string
  count: number
  stages: { code: string; name: string }[]
}

export interface EnquiryListPage {
  enquiries: EnquiryRow[]
  nextCursor: string | null
  departments: DepartmentChip[]
  lateCount: number
}

export interface EnquiryListFilters {
  department: string
  mine: boolean
  q: string
}

export interface EnquirySourceOption {
  id: number
  code: string
  name: string
}

export interface IntakeCountry {
  id: number
  code: string
  name: string
  zone: string | null
  /** "France (Schengen)" */
  label: string
  visaTypes: { offeringId: number; id: number; code: string; name: string }[]
}

export interface LookupClient {
  id: string
  name: string
  kind: string
  mobile: string
  matchedOn: 'PRIMARY' | 'SECONDARY'
}

/** An unfinished case of the looked-up client, so staff can spot a duplicate before saving. */
export interface OpenEnquiry {
  caseNo: string
  /** Department code, e.g. "VISA" */
  department: string
  /** "France (Schengen) · Tourist · 2 adults, 2 children" */
  summary: string
  /** Stage name, e.g. "Documents" */
  stage: string
}

export interface ClientLookup {
  mobile: string
  client: LookupClient | null
  alsoMatches: LookupClient[]
  openEnquiries: OpenEnquiry[]
}

export interface CreateVisaCaseBody {
  mobile: string
  /** Needed for a new number; never overwrites an existing client's name. */
  clientName: string | null
  sourceCode: string
  offeringId: number
  adults: number
  children: number
  /** YYYY-MM */
  travelMonth: string
  /** YYYY-MM-DD or null */
  travelDate: string | null
}

export interface VisaCase {
  id: string
  caseNo: string
  status: EnquiryStatus
  stage: StageRef
  client: { id: string; name: string; mobile: string }
  source: { code: string; name: string }
  country: { id: number; name: string; zone: string | null; label: string }
  visaType: { id: number; name: string }
  adults: number
  children: number
  travelMonth: string
  travelDate: string | null
  owner: PersonRef | null
  dueAt: string | null
  createdAt: string
}
