// API shapes for the enquiry screens. Mirrors Backend/src/modules/enquiries and Backend/src/modules/visa.

export type EnquiryStatus = 'OPEN' | 'POSTPONED' | 'CANCELLED' | 'LOST' | 'CLOSED'
export type EnquiryOrigin = 'STAFF' | 'WHATSAPP_BOT' | 'WEBSITE_FORM' | 'CROSS_SELL' | 'IMPORT'

export interface StageRef {
  /** The department's flow this step belongs to: "VISA"; later "INSURANCE_POLICY" / "INSURANCE_CLAIM". */
  flow: string
  code: string
  name: string
  /** 1, 2, 3… within the flow */
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
  /** Each flow's steps, in order. A row shows its own flow's steps (row.stage.flow). */
  flows: { code: string; stages: { code: string; name: string }[] }[]
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
  /** Whose case it is. Null while it waits for the HOD (e.g. matured, no processor yet). */
  owner: { id: string; name: string } | null
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

export type DocumentRequirement = 'ORIGINAL' | 'XEROX_OK' | 'ARRANGED_BY_US'
export type DocumentStatus = 'PENDING' | 'RECEIVED' | 'MADE' | 'NOT_NEEDED'
export type ReceivedAs = 'ORIGINAL' | 'XEROX'
export type DocumentArrival = 'CLIENT_BRINGS' | 'COLLECTION_BOY'
export type PassportStatus = 'VALID' | 'RENEW_SOON' | 'EXPIRED'

/** A traveller's copy of a checklist line (copied at intake, so master edits never change an open case). */
export interface CaseDocument {
  id: string
  name: string
  detail: string | null
  requirement: DocumentRequirement
  quantity: number
  /** A per-visa instruction for the client, e.g. "signed by both parents". */
  note: string | null
  status: DocumentStatus
  receivedAs: ReceivedAs | null
  receivedAt: string | null
  receivedBy: PersonRef | null
}

/** Flagged until the "I agree" link (WhatsApp) fills it. UNLINKED: the traveller isn't a family member yet. */
export type CaseConsent = { state: 'UNLINKED' } | { state: 'NONE' } | { state: 'ON_FILE'; agreedAt: string }

export interface CaseTraveller {
  id: string
  position: number
  /** "Adult 1", "Child 1" */
  label: string
  isChild: boolean
  /** The linked family member's name; null until named. */
  name: string | null
  member: {
    id: string
    name: string
    relation: { id: number; code: string; name: string } | null
    age: number | null
    passportNumber: string | null
    passportExpiry: string | null
    passportStatus: PassportStatus | null
  } | null
  consent: CaseConsent
  documents: CaseDocument[]
  /** In or made */
  done: number
  /** Everything not marked "Not needed" */
  need: number
  pendingCount: number
}

export interface CaseFollowUp {
  id: string
  /** "What happened" */
  outcome: string
  nextStep: string
  /** "When" */
  nextAt: string
  by: PersonRef
  createdAt: string
}

/** GET /api/visa/cases/:caseNo (Backend/src/modules/visa/visaCase.ts). */
export interface VisaCase {
  id: string
  caseNo: string
  department: { code: string; name: string }
  status: EnquiryStatus
  stage: StageRef
  /** The case's flow, in order: the step chips. */
  steps: { code: string; name: string }[]
  /** Sent back with every case action; a change by someone else in between is a 409 STALE. */
  updatedAt: string
  reason: { id: number; code: string; name: string; kind: 'POSTPONE' | 'CANCEL' } | null
  /** YYYY-MM-DD, while postponed */
  resumeOn: string | null
  client: { id: string; name: string; mobile: string }
  source: { code: string; name: string }
  origin: EnquiryOrigin
  country: { id: number; name: string; zone: string | null; label: string }
  visaType: { id: number; name: string }
  adults: number
  children: number
  travelMonth: string
  travelDate: string | null
  owner: PersonRef | null
  dueAt: string | null
  arrival: DocumentArrival | null
  booklets: { current: number | null; old: number | null }
  maturedAt: string | null
  maturedBy: PersonRef | null
  travellers: CaseTraveller[]
  /** The latest 20, newest first */
  followUps: CaseFollowUp[]
  createdBy: PersonRef | null
  createdAt: string
}
