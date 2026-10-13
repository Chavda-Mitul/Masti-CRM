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
  /** Why it was postponed or cancelled. */
  reason: { name: string } | null
  /** When a postponed case comes back, YYYY-MM-DD. */
  resumeOn: string | null
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

/** The list's Open / Postponed / Cancelled switch, plus "To assign" (open, nobody's yet) for the HOD and the Head. */
export type ListStatus = Extract<EnquiryStatus, 'OPEN' | 'POSTPONED' | 'CANCELLED'> | 'TO_ASSIGN'

export interface EnquiryListFilters {
  status: ListStatus
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
/** The processor's own check of a paper in Step 3 (docs/decisions/0007-visa-file-prep.md Decision 3). */
export type DocumentCheck = 'CHECKED' | 'NEEDS_REPLACING'
export type DocumentArrival = 'CLIENT_BRINGS' | 'COLLECTION_BOY'
export type EntryType = 'SINGLE' | 'DOUBLE' | 'MULTIPLE'

/** Trip details (0007 Decision 4). Dates are YYYY-MM-DD; the duration is worked out from them. */
export interface CaseTrip {
  departOn: string | null
  returnOn: string | null
  entryType: EntryType | null
  /** The hotel's name and city. */
  hotelStay: string | null
}
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
  /** Step 3: null until the processor checks it. */
  check: DocumentCheck | null
  /** Why it needs replacing, from Settings → Masters → Document problems. */
  checkReason: { id: number; name: string } | null
  checkedAt: string | null
  checkedBy: PersonRef | null
}

/** A file kept in the private document store (0007 Decision 8). It opens through a short-lived link. */
export interface CaseFile {
  id: string
  /** "VISA-2026-0001_Mehta_file.pdf" */
  fileName: string
  sizeBytes: number
  pageCount: number
  uploadedAt: string
  uploadedBy: PersonRef
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
  /** Step 3, from the government portal (0007 Decision 5). */
  ackNo: string | null
  appointmentAt: string | null
  documents: CaseDocument[]
  /** In or made */
  done: number
  /** Everything not marked "Not needed" */
  need: number
  pendingCount: number
  /** Step 3: papers the processor has checked, and papers flagged to be replaced. */
  checked: number
  needsReplacing: number
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
/** The case's vendor. isActive false: switched off since it was picked, so "File ready" will ask for another. */
export interface CaseVendor {
  id: number
  name: string
  city: string
  isActive: boolean
  contactName: string | null
  /** +91XXXXXXXXXX */
  mobile: string | null
  /** false when the case's country was taken off the vendor after it was picked: "File ready" asks for another. */
  coversCountry: boolean
}

/** "Several files in one" (the vendor's shared docket) or "One file per docket" (0008 Decision 2). */
export type DocketKind = 'GROUP' | 'OWN'

/** One case in a docket: other cases show only this much (0008 Decision 4). */
export interface DocketCase {
  caseNo: string
  /** "Mehta" */
  family: string
  /** "France" */
  country: string
  /** Current booklets, or one per traveller when nobody counted them */
  passports: number
  oldPassports: number
  isThisCase: boolean
}

/** The docket a case goes to the vendor in (0008, Step 4). */
export interface CaseDocket {
  /** "D-2026-0001" */
  docketNo: string
  kind: DocketKind
  status: 'OPEN' | 'DISPATCHED'
  /** "Open since 12 Oct, not sent yet" from the next day on */
  openedAt: string
  vendor: { name: string; city: string }
  cases: DocketCase[]
  totalPassports: number
  totalOldPassports: number
}

/** GET /api/visa/cases/:caseNo/sticker: the parcel label (0008 Decision 5). */
export interface DocketStickerData {
  docketNo: string
  status: 'OPEN' | 'DISPATCHED'
  vendor: { name: string; city: string }
  cases: { caseNo: string; passports: number; oldPassports: number }[]
  totalPassports: number
  totalOldPassports: number
  /** Masti's details (the company.details setting) */
  from: { name: string; address: string; phone: string }
  /** The label size (the visa.sticker setting) */
  size: { widthMm: number; heightMm: number }
}

/** A traveller's amount: one lump sum, or itemised (0009 Decision 2). */
export type QuoteForm = 'LUMP_SUM' | 'ITEMISED'

/** The price on a visa case (docs/decisions/0009-visa-invoice.md Decision 2). Money is in paise. */
export interface CaseQuote {
  processingSpeed: { id: number; name: string; isActive: boolean }
  serviceChargePaise: number
  lines: {
    travellerId: string
    form: QuoteForm
    lumpSumPaise: number | null
    embassyFeePaise: number | null
    vfsFeePaise: number | null
    otherFeePaise: number | null
    totalPaise: number
  }[]
  /** The travellers' amounts together (passed on, no GST) */
  travellersPaise: number
  gstRatePercent: number
  /** GST on the service charge only */
  gstPaise: number
  totalPaise: number
  /** False if a traveller has no amount */
  complete: boolean
  /** The quote's own token: send it back when saving */
  updatedAt: string
  updatedBy: PersonRef
}

/** The case's locked tax invoice (docs/decisions/0009-visa-invoice.md), once raised. */
export interface CaseInvoice {
  /** "MVI00001379" */
  invoiceNo: string
  /** YYYY-MM-DD (IST) */
  issuedOn: string
  issuedAt: string
  issuedBy: PersonRef
  taxType: InvoiceTaxType
  gstPaise: number
  totalPaise: number
  /** The PDF as raised: open it like any case file. */
  file: { id: string; fileName: string }
}

export type InvoiceTaxType = 'INTRA_STATE' | 'INTER_STATE'

export type InvoiceBlockerKind = 'QUOTE' | 'TRAVELLERS' | 'CLIENT' | 'COMPANY' | 'NOT_ENGLISH'

/** GET /api/visa/cases/:caseNo/invoice/check: what blocks raising it, or what it will say. */
export interface InvoiceCheck {
  blockers: { kind: InvoiceBlockerKind; label: string; items: string[] }[]
  alreadyRaised: string | null
  preview: {
    invoiceNo: string
    gstRatePercent: number
    taxType: InvoiceTaxType
    grossPaise: number
    serviceChargePaise: number
    cgstPaise: number
    sgstPaise: number
    igstPaise: number
    totalPaise: number
  } | null
}

/** PUT /api/visa/cases/:caseNo/quote */
export interface SaveQuoteBody {
  processingSpeedId: number
  serviceChargePaise: number
  lines: (
    | { travellerId: string; form: 'LUMP_SUM'; lumpSumPaise: number }
    | { travellerId: string; form: 'ITEMISED'; embassyFeePaise: number; vfsFeePaise: number; otherFeePaise: number }
  )[]
  updatedAt: string | null
}

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
  /** The visa's switches (0007 Decision 6), read live: what "File ready" asks for. */
  appointmentNeeded: boolean
  vendorNeeded: boolean
  adults: number
  children: number
  travelMonth: string
  travelDate: string | null
  trip: CaseTrip
  owner: PersonRef | null
  dueAt: string | null
  arrival: DocumentArrival | null
  booklets: { current: number | null; old: number | null }
  maturedAt: string | null
  maturedBy: PersonRef | null
  /** Step 3's saved file, kept as proof: the current upload, or null. */
  finalFile: CaseFile | null
  /** Every upload of the final file, the current one included; older ones are kept. */
  finalFileCopies: number
  /** The largest PDF the server accepts (setting visa.finalFile). */
  finalFileMaxMb: number
  /** The submission agent picked during File preparation (0007 Decision 7), or null. */
  vendor: CaseVendor | null
  /** "File ready — add to docket" (0007 Decision 9): Step 3 is done and read-only. */
  fileReadyAt: string | null
  fileReadyBy: PersonRef | null
  /** Step 4: the docket this case is in (0008 Decision 2), or null. */
  docket: CaseDocket | null
  /** While it isn't in one: the vendor's shared open docket it would join, if that holds any files. */
  openDocket: { docketNo: string; caseCount: number } | null
  /** GST on the service charge (the setting visa.invoice), for a quote being entered */
  gstRatePercent: number
  /** The price (0009), or null until someone enters it */
  quote: CaseQuote | null
  /** The locked tax invoice (0009), or null until it is raised */
  invoice: CaseInvoice | null
  travellers: CaseTraveller[]
  /** The latest 20, newest first */
  followUps: CaseFollowUp[]
  createdBy: PersonRef | null
  createdAt: string
}

/** The follow-up desk's tabs and its Mine / Whole department switch (0006 Decision 9). */
export type FollowUpBucket = 'OVERDUE' | 'TODAY' | 'WEEK' | 'POSTPONED'
export type FollowUpScope = 'MINE' | 'ALL'

/** GET /api/enquiries/follow-ups (Backend/src/modules/enquiries/followUpDesk.service.ts). */
export interface FollowUpDeskRow {
  id: string
  caseNo: string
  department: { code: string; name: string }
  client: { id: string; name: string; mobile: string }
  summary: string
  status: EnquiryStatus
  reason: { name: string } | null
  resumeOn: string | null
  /** "8 of 11 documents pending", or the stage's next step. */
  whatFor: string
  lastContact: { outcome: string; at: string } | null
  owner: PersonRef | null
  dueAt: string | null
  updatedAt: string
}

export interface FollowUpDesk {
  rows: FollowUpDeskRow[]
  /** More rows than the desk shows at once. */
  more: boolean
  counts: { overdue: number; today: number; week: number; postponed: number }
}

/** GET /api/enquiries/follow-ups/badge: the sidebar's red number. ALL for an HOD (their departments) and the Head (everyone). */
/** What still stands between a case and maturity (409 NOT_READY from "Mark documents complete"). */
export type TripField = 'departOn' | 'returnOn' | 'entryType'

/** What "File ready" still needs (409 NOT_READY details.missing, 0007 Decision 9). */
export interface FileReadyMissing {
  /** Papers that came in or were made, not checked yet or needing replacing, by traveller */
  papers: { traveller: string; toCheck: string[]; needsReplacing: string[] }[]
  /** Travellers without an acknowledgement number */
  ackNo: string[]
  /** Travellers without an appointment (empty when the visa needs none) */
  appointment: string[]
  /** No saved file yet */
  finalFile: boolean
  /** null when fine, or when the visa needs no vendor */
  vendor: 'NONE' | 'SWITCHED_OFF' | 'NOT_COVERING' | null
  trip: TripField[]
}

export interface MaturityMissing {
  /** Travellers not yet linked to a family member: "Child 1" */
  unnamed: string[]
  /** Papers still pending, by traveller */
  pending: { traveller: string; documents: string[] }[]
}

export interface FollowUpBadge {
  overdue: number
  scope: FollowUpScope
}

/** POST /api/enquiries/:caseNo/follow-ups. "When" is a day and a time in India. */
export interface LogFollowUpBody {
  outcomeId: number
  nextStepId: number
  nextOn: string
  at: string
  updatedAt: string
}
