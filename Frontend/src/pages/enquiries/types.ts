// API shapes for the enquiry screens. Mirrors Backend/src/modules/enquiries and Backend/src/modules/visa.

import type { ScanType } from '../clients/scanFiles'

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
  /** A visa case whose passports are still to hand back: a cancelled one stays on the Open tab until then (0006 amendment 15). */
  toHandBack?: boolean
  stage: StageRef
  /** This case's next step: the step's own label, except where the case decides it ("Mark received" in transit). */
  nextStep: string
  /** Documents complete and gone to processing: nobody's yet, it waits for a processor (else for an owner). */
  matured: boolean
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

/**
 * A client with a family member whose own number this is (0004 amendment of 20 Oct 2026). Only sent when no client
 * has the number as a main or extra one.
 */
export interface FamilyMatch {
  client: Omit<LookupClient, 'matchedOn'>
  members: { id: string; name: string; relation: string }[]
  /** No room for another extra number: the form offers the client's main number instead. */
  extraNumbersFull: boolean
  openEnquiries: OpenEnquiry[]
}

export interface ClientLookup {
  mobile: string
  client: LookupClient | null
  alsoMatches: LookupClient[]
  openEnquiries: OpenEnquiry[]
  familyMatches: FamilyMatch[]
}

export interface CreateVisaCaseBody {
  mobile: string
  /** Needed for a new number; never overwrites an existing client's name. */
  clientName: string | null
  /** "Use Rakesh Mehta": the number is this client's family member's; it is saved there as an extra number. */
  familyClientId: string | null
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
/** ON_FILE: printed from the copy in the client's document vault (docs/decisions/0016-client-documents.md Decision 5). */
export type ReceivedAs = 'ORIGINAL' | 'XEROX' | 'ON_FILE'
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
  /** The current copy of this paper in the client's vault, for a named traveller (0016 Decision 5); null if none. */
  onFile: { id: string; uploadedAt: string; contentType: ScanType; pageCount: number | null; sizeBytes: number } | null
  /** The copy an On file paper was printed from; it may be older than onFile. */
  fromScan: { id: string; uploadedAt: string } | null
  /** "Scan not saved" (0016 Decision 7): ticked Original or Xerox, the master asks for a scan, none kept during this case. */
  noScan: boolean
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

/**
 * The consent form's details on the person (docs/decisions/0022-consent-form.md, part 1): staff fill them in by asking
 * the client, for life. filledAt stays null until the form is saved (the date of birth may already be there).
 */
export interface ConsentDetails {
  dateOfBirth: string | null
  spouseDateOfBirth: string | null
  anniversary: string | null
  motherDateOfBirth: string | null
  fatherDateOfBirth: string | null
  residentialAddress: string | null
  officeAddress: string | null
  /** A year, in whole rupees. */
  annualIncome: number | null
  profession: string | null
  education: string | null
  filledAt: string | null
  filledBy: PersonRef | null
  /** The person's optimistic-lock token. */
  personUpdatedAt: string
}

/** Every field each time; null clears one. updatedAt is the person's (personUpdatedAt). */
export interface ConsentDetailsBody {
  dateOfBirth: string
  spouseDateOfBirth: string | null
  anniversary: string | null
  motherDateOfBirth: string | null
  fatherDateOfBirth: string | null
  residentialAddress: string
  officeAddress: string | null
  annualIncome: number | null
  profession: string | null
  education: string | null
  updatedAt: string
}

/**
 * Flagged until the client agrees through the "I agree" link (0022 part 2), or a consent signed on paper before the CRM
 * is marked on file (part 3, paperYear). UNLINKED: the traveller isn't a family member yet.
 */
export type CaseConsent =
  | { state: 'UNLINKED' }
  /** link: the person's open "I agree" link (0022 part 2), sent when the details were saved; null when none is open. */
  | { state: 'NONE'; details: ConsentDetails; link: { sentAt: string; toMobile: string } | null }
  | { state: 'ON_FILE'; id: string; agreedAt: string; paperYear: number | null; details: ConsentDetails }

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
  /** At the door (0015 phase 5): the delivery boy's job, whose proof (the code, his selfie, the place) is on the case's field jobs. */
  fieldJobId: string | null
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
  /**
   * An approved traveller's sticker, checked when the passports were received (0013 Decision 5); an e-visa's PDF, checked
   * at Decision (0025). Null until checked.
   */
  stickerCheck: StickerCheck | null
  /** The current refusal letter (0012 Decision 4), and how many were uploaded; only while the traveller is refused. */
  refusalLetter: (CaseFile & { copies: number }) | null
  /** An e-visa's current PDF (0025), and how many were uploaded; only while the traveller is approved. */
  evisa: (CaseFile & { copies: number }) | null
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

/**
 * GET /api/visa/cases/:caseNo/send-evisa/check (0025, part 3): what blocks "Send the e-visa", who gets a message with
 * which file, and what happens to the case.
 */
export interface SendEvisaCheck {
  /** One line per approved traveller who isn't ready: no PDF, not checked, or doesn't match. */
  blockers: { kind: 'NO_PDF' | 'NOT_CHECKED' | 'MISMATCH'; travellerId: string; label: string }[]
  /** Each approved traveller, who gets one WhatsApp with their PDF. */
  travellers: { name: string; fileName: string | null }[]
  /** Booklets counted in at intake, which we hold. */
  held: number
  /** No passports held: the case moves to Delivered and closes. */
  closes: boolean
  /** With passports held: when it's due for the handover ⚠️. */
  dueAt: string | null
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

/**
 * GET /api/visa/cases/:caseNo/recall/check (0011 Decision 6): what taking the file back gives back, per traveller.
 * `invoiceNo` (and `creditNoteNo`) are null when nothing can go back: a cancelled case whose invoice was already
 * cancelled whole (docs/decisions/0006-visa-documents.md amendment 15).
 */
export interface RecallCheck {
  invoiceNo: string | null
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
  creditNoteNo: string | null
  dueAt: string
  blockers: { kind: string; label: string; items: string[] }[]
}

/** GET /api/visa/cases/:caseNo/invoice/cancel/check (0011 Decision 5): what cancelling it gives back, and what blocks it. */
export interface CancelInvoiceCheck {
  invoiceNo: string
  alreadyCancelled: string | null
  /** The case is cancelled: no corrected invoice follows, so only the Visa HOD or the Head may (0006 amendment 15). */
  hodOnly: boolean
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

/** How a reminder reaches the client (the setting visa.documentReminders). */
export type ReminderChannel = 'WHATSAPP' | 'SMS'

/** Pending-document reminders on one case. Nothing is sent until WhatsApp is connected. */
export interface CaseReminders {
  /** The case's own switch. */
  on: boolean
  /** On for every case in Settings. */
  enabled: boolean
  everyDays: number
  /** "11:00", India time. */
  sendAt: string
  channel: ReminderChannel
  /** When the next one goes out; null when none is due (off, not open, or nothing missing). */
  nextAt: string | null
}

/** The portal a case's visa opens (0024 component 3): who's on its list, and the CRM helper's IDs. Never its ID or password. */
export interface CasePortal {
  id: string
  name: string
  userIds: string[]
  helperIds: string[]
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
  /** The visa (country × type): its settings page is /settings/masters/checklists/:offeringId. */
  offeringId: number
  country: { id: number; name: string; zone: string | null; label: string }
  visaType: { id: number; name: string }
  /** The visa's switches (0007 Decision 6), read live: what "File ready" asks for. */
  appointmentNeeded: boolean
  vendorNeeded: boolean
  /** The portal its visa opens with Log in for me (0024 component 3); null when none is saved. */
  portal: CasePortal | null
  adults: number
  children: number
  travelMonth: string
  travelDate: string | null
  trip: CaseTrip
  owner: PersonRef | null
  dueAt: string | null
  arrival: DocumentArrival | null
  booklets: { current: number | null; old: number | null }
  /** The Reminders card (0006 amendment 19): the case's switch, the setting, and the next one (null when none is due). */
  reminders: CaseReminders
  maturedAt: string | null
  maturedBy: PersonRef | null
  /** Step 3's saved file, kept as proof: the current upload, or null. */
  finalFile: CaseFile | null
  /** Every upload of the final file, the current one included; older ones are kept. */
  finalFileCopies: number
  /** The largest PDF the server accepts (setting visa.finalFile). */
  finalFileMaxMb: number
  /** The largest e-visa PDF the server accepts (0025): WhatsApp's limit, or the final file's if lower. */
  evisaMaxMb: number
  /** The largest scan "Save scan" takes (setting clients.documents). */
  scanMaxMb: number
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
  /** "Send the e-visa" (0025, part 3): who sent the approved travellers' e-visas to the client, and when. */
  evisaSent: { at: string; by: PersonRef | null } | null
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

/** Where a message to the client has got to (0021). SKIPPED: its wording is switched off. */
export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED'

/** One message on the case's "Sent to the client" card (0021), oldest first. Times are ISO. */
export interface CaseMessage {
  id: string
  /** The message's name: "All documents received". */
  title: string
  /** Its words, exactly as sent. */
  body: string
  /** The case's file it carried (0025, part 2): an e-visa's PDF. */
  attachment: { fileName: string } | null
  status: MessageStatus
  /** Why it didn't go or wasn't delivered, in plain words. */
  error: string | null
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
  /** Outside production it went to the test number instead of the client. */
  toTestNumber: boolean
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
  /** Documents complete and gone to processing: nobody's yet, it waits for a processor (else for an owner). */
  matured: boolean
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

// ---------------------------------------------------------------------------
// The covering letter (docs/decisions/0019-covering-letters.md Decisions 8–12)
// ---------------------------------------------------------------------------

/** The letter made for a case: the wording used, by whom and when. */
export interface CoveringLetterMade {
  formatId: number
  formatName: string
  /** The wording its text started from: sent again when it's made again from this text. */
  versionId: number
  effectiveFrom: string
  madeAt: string
  madeBy: { id: string; name: string } | null
  /** The letter as made (0019 amendments 1 and 3): what every print shows; its tables are | lines. */
  letter: string
}

/** GET /api/visa/cases/:caseNo/covering-letter: the card's view. */
export interface CoveringLetterView {
  /** The letters that fit the case, in their order; the first is picked when nothing else is. */
  letters: { id: number; name: string; sample: boolean }[]
  /**
   * One letter drafted from the case today; null when none fits. What the case lacks is a ⟦mark⟧ in the draft, for staff
   * to type over, and is listed in missing so it can be added to the case too.
   */
  selected: {
    formatId: number
    name: string
    versionId: number
    effectiveFrom: string
    sample: boolean
    draft: string
    missing: string[]
  } | null
  made: CoveringLetterMade | null
  fits: { visaType: string; country: string; travellers: number }
}

/** GET …/covering-letter/print: the letter made, as it was made, and the space to leave for the letterhead. */
export interface CoveringLetterPrint extends CoveringLetterMade {
  caseNo: string
  letterheadMm: number
}
