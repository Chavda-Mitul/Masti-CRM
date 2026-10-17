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
export type ListStatus = Extract<EnquiryStatus, 'OPEN' | 'POSTPONED' | 'CANCELLED' | 'CLOSED'> | 'TO_ASSIGN'

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

/** The embassy's decision on one traveller (docs/decisions/0012-visa-decision.md Decision 2). */
export type VisaOutcome = 'APPROVED' | 'REFUSED'

/** Approved with the sticker (or e-visa) number and the dates it's valid (YYYY-MM-DD), or Refused with none. */
export interface TravellerDecision {
  outcome: VisaOutcome
  visaNo: string | null
  validFrom: string | null
  validTo: string | null
}

/** One stop on the collection or delivery boy's run (docs/decisions/0015-field-staff-app.md). */
export interface FieldJob {
  id: string
  kind: 'PICKUP' | 'DELIVERY'
  status: 'BOOKED' | 'DONE' | 'FAILED' | 'CANCELLED'
  assignee: { id: string; name: string; mobile: string }
  day: string
  slot: { id: number; name: string; startsAt: string; endsAt: string }
  address: string
  mapLink: string | null
  mobile: string
  bookedAt: string
  bookedBy: PersonRef | null
  cancelledAt: string | null
  cancelledBy: PersonRef | null
  /** Done or couldn't complete (0015 phase 4): when, the place his phone gave, and why it couldn't be. */
  finishedAt: string | null
  place: { lat: number; lng: number; accuracy: number } | null
  failReason: { id: number; name: string } | null
  /** Done (0015 Decision 4): the booklets he counted, his selfie, and when the client confirmed the code. */
  counted: { current: number; old: number } | null
  selfie: { id: string; fileName: string } | null
  otpConfirmedAt: string | null
}

/** Who can be sent: the active field staff (GET /api/visa/field-staff). */
export interface FieldStaff {
  id: string
  name: string
  mobile: string
}

/** The passports handed back to the client (docs/decisions/0014-visa-delivered.md): how, when and by whom, the booklets, who collected them, their photo. */
export interface Handover {
  mode: 'OFFICE' | 'DELIVERY'
  at: string
  by: PersonRef | null
  booklets: { current: number; old: number }
  receiver: { name: string; travellerId: string | null }
  photo: { id: string; fileName: string } | null
}

/** An approved traveller's visa sticker against the passport's name and dates, when received (0013 Decision 5). */
export type StickerCheck = 'MATCHES' | 'MISMATCH'

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
  /** Step 6 (0012): null until the decision is recorded */
  decision: TravellerDecision | null
  /** An approved traveller's sticker, checked when the passports were received (0013 Decision 5); null until then */
  stickerCheck: StickerCheck | null
  /** The current refusal letter (0012 Decision 4), and how many were uploaded; only while the traveller is refused. */
  refusalLetter: (CaseFile & { copies: number }) | null
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
  /** Where the dispatch email goes (0008 Decision 8) */
  email: string
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
  /** "MVI00000001", or null until the case's invoice is raised (0009) */
  invoiceNo: string | null
  /** Who may dispatch (0008 Decision 3): a processor who owns at least one case in the docket */
  ownerId: string | null
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
  /** Set when dispatched (0008 Decision 9): the courier, its slip number (null for one with none), who and when */
  courier: { name: string; awbNeeded: boolean } | null
  awbNo: string | null
  /** The email to the vendor (0008 Decision 8), once dispatched: when and to whom it went, or why not, or that it's going now */
  email: { sentAt: string | null; to: string | null; error: string | null; sending: boolean } | null
  dispatchedAt: string | null
  dispatchedBy: PersonRef | null
  cases: DocketCase[]
  totalPassports: number
  totalOldPassports: number
}

export type DispatchBlockerKind = 'INVOICE' | 'VENDOR_OFF'

/** GET /api/visa/cases/:caseNo/dispatch/check (0008 Decision 9): what blocks dispatch, and when the cases come back due. */
export interface DispatchCheck {
  docketNo: string
  alreadyDispatched: boolean
  canDispatch: boolean
  blockers: { kind: DispatchBlockerKind; label: string; items: string[] }[]
  vendor: { name: string; city: string; email: string }
  /** The next open office day at 11:00 ⚠️: "Confirm vendor got it" */
  confirmAt: string
}

/** GET /api/visa/cases/:caseNo/submit-online/check (0008 Decision 11): what blocks an e-visa, and when it comes back due. */
export interface SubmitOnlineCheck {
  blockers: DispatchCheck['blockers']
  /** The next open office day at 11:00 ⚠️: "Check the portal" */
  dueAt: string
}

/** GET /api/visa/cases/:caseNo/vendor-received/check (0011 Decision 2): when the file comes back due, and why then. */
export interface VendorReceivedCheck {
  dueAt: string
  /** At the earliest appointment still to come, or else the next office day (the setting visa.submissionCheck ⚠️). */
  dueReason: 'APPOINTMENT' | 'NEXT_DAY'
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
  /** The cancelled invoice this one replaces (0011 Decision 5), or null for the case's first. */
  replaces: string | null
  /** What PART credit notes gave back on it (a recall, 0011 Decision 6); it still stands. */
  partCredits: {
    creditNoteNo: string
    issuedOn: string
    reason: string
    totalPaise: number
    file: { id: string; fileName: string }
  }[]
  /** The WHOLE credit note that cancelled it (0011 Decision 5): it no longer counts as the case's invoice. */
  cancelled: {
    creditNoteNo: string
    /** YYYY-MM-DD (IST) */
    issuedOn: string
    issuedBy: PersonRef
    reason: string
    totalPaise: number
    file: { id: string; fileName: string }
  } | null
}

/** GET /api/visa/cases/:caseNo/additional-invoice/check (0011 Decision 7): what it adds to, its number, what blocks it. */
export interface AdditionalInvoiceCheck {
  mainInvoiceNo: string
  alreadyRaised: string | null
  /** The cancelled additional invoice this one corrects, or null for the file's first */
  replaces: string | null
  /** "MVI00000001-A"; a correction takes the next letter, "-B" */
  invoiceNo: string
  blockers: { kind: string; label: string; items: string[] }[]
}

/** The file's one additional invoice (0011 Decision 7): an invoice of extra charges, with no GST. */
export type CaseAdditionalInvoice = CaseInvoice & { charges: { name: string; amountPaise: number }[] }

/** GET /api/visa/cases/:caseNo/recall/check (0011 Decision 6): what taking the file back gives back, per traveller. */
export interface RecallCheck {
  invoiceNo: string
  lines: {
    /** The invoice's line, 1, 2, 3… */
    position: number
    name: string
    form: 'LUMP_SUM' | 'ITEMISED'
    embassyFeePaise: number | null
    /** What the traveller was charged: the most that can go back */
    chargedPaise: number
    /** The embassy fee, or nothing on a lump sum */
    defaultRefundPaise: number
  }[]
  defaultTotalPaise: number
  /** The Visa HOD or the Head: "Change refund (HOD)" */
  canChangeRefund: boolean
  creditNoteNo: string
  dueAt: string
  blockers: { kind: string; label: string; items: string[] }[]
}

/** GET /api/visa/cases/:caseNo/invoice/cancel/check (0011 Decision 5): what cancelling it gives back, and what blocks it. */
export interface CancelInvoiceCheck {
  invoiceNo: string
  alreadyCancelled: string | null
  blockers: { kind: string; label: string; items: string[] }[]
  preview: {
    creditNoteNo: string
    taxType: InvoiceTaxType
    grossPaise: number
    serviceChargePaise: number
    cgstPaise: number
    sgstPaise: number
    igstPaise: number
    totalPaise: number
  }
}

export type InvoiceTaxType = 'INTRA_STATE' | 'INTER_STATE'

export type InvoiceBlockerKind = 'QUOTE' | 'TRAVELLERS' | 'CLIENT' | 'COMPANY' | 'NOT_ENGLISH'

/** GET /api/visa/cases/:caseNo/invoice/check: what blocks raising it, or what it will say. */
export interface InvoiceCheck {
  blockers: { kind: InvoiceBlockerKind; label: string; items: string[] }[]
  alreadyRaised: string | null
  /** The cancelled invoice the new one replaces (0011 Decision 5), or null for the case's first */
  replaces: string | null
  preview: {
    invoiceNo: string
    /** The quote it was made from: sent back with the rate, tax type and total when raising */
    quoteUpdatedAt: string
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
  /** With their email (the field boy's one-time code goes there, 0015) and address in one line */
  client: { id: string; name: string; mobile: string; email: string | null; address: string }
  /** The collection and delivery boy's jobs (0015), newest first */
  fieldJobs: FieldJob[]
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
  /** An e-visa's "Submitted online" (0008 Decision 11): who and when, instead of a docket. */
  submittedOnline: { at: string; by: PersonRef | null } | null
  /** Step 5 (0011 Decision 2): "Vendor got it, papers checked", who and when. */
  vendorReceived: { at: string; by: PersonRef | null } | null
  /** "Submitted at the embassy" (0011 Decisions 3 and 4): the vendor's file number, the embassy and the collection date. */
  submission: {
    vendorFileNo: string
    embassy: { id: number; name: string; city: string }
    /** YYYY-MM-DD */
    collectionOn: string
    at: string
    by: PersonRef | null
  } | null
  /** GST on the service charge (the setting visa.invoice), for a quote being entered */
  gstRatePercent: number
  /** The price (0009), or null until someone enters it */
  quote: CaseQuote | null
  /** The locked tax invoice (0009), or null until it is raised */
  invoice: CaseInvoice | null
  /** The earlier invoices of the chain, each cancelled and replaced, newest first (0011 Decision 5) */
  earlierInvoices: CaseInvoice[]
  /** The file's one additional invoice, "MVI…-A" (0011 Decision 7), or null until raised */
  additionalInvoice: CaseAdditionalInvoice | null
  /** Earlier additional invoices, each cancelled and replaced, newest first */
  earlierAdditionalInvoices: CaseAdditionalInvoice[]
  /** "Take the file back" (0011 Decision 6): who, when, why, and the credit note that gave the embassy fee back */
  recall: {
    at: string
    by: PersonRef | null
    reason: string
    creditNote: { creditNoteNo: string; totalPaise: number; file: { id: string; fileName: string } } | null
  } | null
  /** "Record the decision" (0012 Decision 6): who and when; each traveller's outcome is on the traveller */
  decision: { at: string; by: PersonRef | null } | null
  /** "Passports on the way back" (0013 Decision 3): the day the vendor collected them, the day expected, who and when */
  passportsBack: { collectedOn: string; expectedOn: string; at: string; by: PersonRef | null } | null
  /**
   * "Mark received" (0013 Decision 5): in our passport stock, by whom and when, with the booklets counted (plus any
   * received later). `missing`: per kind, what went out and isn't back; while any is and the shortfall isn't cleared, the
   * handover waits (amended 17 Oct 2026). `shortfallCleared`: when, by whom and why it won't come back.
   */
  passportsReceived: {
    at: string
    by: PersonRef | null
    booklets: { current: number; old: number }
    missing: { current: number; old: number }
    shortfallCleared: { at: string; by: PersonRef | null; reason: string } | null
  } | null
  /** Handed back to the client (0014): null until then */
  handover: Handover | null
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
