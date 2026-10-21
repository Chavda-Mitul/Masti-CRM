// API shapes for the system masters (Backend/src/modules/holidays, visaMasters; docs/decisions/0005-system-masters.md).
// Dates are "YYYY-MM-DD" (India); timestamps are ISO strings (UTC).

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

export type HolidayRepeat = 'NONE' | 'WEEKLY'
export type HolidayStatus = 'ACTIVE' | 'REMOVED'
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
  reference: string | null
  isNew: boolean
  /** Null for entries set up with the system (the seed). */
  addedBy: { id: string; name: string } | null
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
}

/** Masti's bank account, printed on every invoice (0009 Decision 8). */
export interface BankDetails {
  accountName: string
  accountNo: string
  bankName: string
  branch: string
  ifsc: string
  swift: string | null
}

/** Masti's own details: the "From" on the parcel sticker (0008 Decision 5) and the invoice's header (0009 Decision 8). */
export interface CompanyDetails {
  name: string
  address: string
  phone: string
  /** The 24/7 number */
  phone2: string | null
  email: string | null
  /** "www.example.com" */
  website: string | null
  pan: string | null
  gstin: string | null
  /** GST state code, "24" for Gujarat */
  stateCode: string | null
  bank: BankDetails | null
}

export type CompanyImageKind = 'logo' | 'signature'

/** The current logo or signature (the newest upload). */
export interface CompanyImage {
  contentType: 'image/png' | 'image/jpeg'
  sizeBytes: number
  uploadedAt: string
  uploadedBy: { id: string; name: string }
}

/** GET /api/company/details */
export interface CompanyView {
  details: CompanyDetails
  images: Record<CompanyImageKind, CompanyImage | null>
  /** What the first invoice still needs: "PAN", "Bank details", "Logo"… */
  missingForInvoice: string[]
}

/** GET /api/company/invoice-terms */
export interface InvoiceTerms {
  lines: string[]
}

/** The setting visa.invoice (0009 Decisions 3 and 4): Masti's number series and GST on the service charge. */
export interface InvoiceSetting {
  prefix: string
  digits: number
  startAt: number
  gstRatePercent: number
  sac: string
}

/** The setting visa.documentReminders (0006 amendment 19): pending-document reminders to the client. */
export interface DocumentRemindersSetting {
  enabled: boolean
  everyDays: number
  /** "11:00", India time. */
  sendAt: string
  channel: 'WHATSAPP' | 'SMS'
}

/** When a case comes back due: the next open office day `afterDays` after the event, at `at` (IST, "HH:mm"). */
export interface OfficeDayTiming {
  afterDays: number
  at: string
}

/** GET /api/visa/settings (Backend visa.schemas.ts visaSettingsSchema): the parts the Settings screens show. */
export interface VisaSettings {
  invoice: InvoiceSetting
  firstFollowUp: OfficeDayTiming
  vendorConfirm: OfficeDayTiming
  onlineCheck: OfficeDayTiming
  submissionCheck: OfficeDayTiming
  recallReturn: OfficeDayTiming
  passportsBackCheck: OfficeDayTiming
  arrivalCheck: OfficeDayTiming
  assignCheck: OfficeDayTiming
  handoverCheck: OfficeDayTiming
  /** The collection reminder: the open office day `daysBefore` the expected collection date, at `at`. */
  collectionCheck: { daysBefore: number; at: string }
  /** How long a passport must still run after the trip comes back; less is a warning (decided 19 Oct 2026). */
  passportValidity: { monthsAfterReturn: number }
  /** From this age a traveller counts as an adult, for the warnings (decided 19 Oct 2026). */
  childAge: { adultFrom: number }
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
export type HolidayFilter = 'upcoming' | 'removed'

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

/** GET /api/holidays/blocked: a day a target is closed, and the holidays that close it (0005 §3). */
/** Whose closed days GET /api/holidays/blocked returns: an embassy's, or our office's (0005 §3). */
export type BlockTarget = { embassyId: number } | { office: true }

export interface BlockedDay {
  date: string
  holidays: { id: string; name: string }[]
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

/**
 * A visa submission agent (docs/decisions/0007-visa-file-prep.md Decision 7). Only the Visa HOD or the Head adds one,
 * and adding approves it. Switched off, never deleted.
 */
export interface Vendor {
  id: number
  kind: 'VISA_AGENT'
  name: string
  city: string
  contactName: string | null
  /** +91XXXXXXXXXX */
  mobile: string | null
  /** Where the dispatch email goes (0008 Decision 8): every vendor has one */
  email: string
  isActive: boolean
  /** The countries it submits files for, by name. */
  countries: { id: number; code: string; name: string; zone: string | null }[]
  createdAt: string
  updatedAt: string
}

/** Who travels on the cases a covering letter is for (docs/decisions/0019-covering-letters.md). */
export type CoveringLetterParty = 'ONE' | 'SEVERAL'

/** In use today, still to come, or replaced by a later one. The server decides, by today in India. */
export type WordingStatus = 'IN_USE' | 'SCHEDULED' | 'EARLIER'

/** Null for a sample wording, set up with the system. */
export type WordingAuthor = { id: string; name: string } | null

/**
 * One version of the consent form's wording (docs/decisions/0022-consent-form.md, part 2b). The list comes newest first:
 * the first is the one clients agree to. A null addedBy is the draft set up with the system.
 */
export interface ConsentWordingVersion {
  id: number
  body: string
  createdAt: string
  addedBy: WordingAuthor
}

/** A covering-letter format in the list: its details, and the wording in use without its text. */
export interface CoveringLetterSummary {
  id: number
  name: string
  visaType: { id: number; code: string; name: string; isActive: boolean }
  party: CoveringLetterParty
  /** By name. A country switched off since stays on the letter. */
  countries: { id: number; code: string; name: string; zone: string | null; isActive: boolean }[]
  sortOrder: number
  isActive: boolean
  /** The wording in use today; null while the first one is still to come. */
  inUse: { id: number; effectiveFrom: string; addedBy: WordingAuthor } | null
  /** The soonest wording still to come. */
  next: { id: number; effectiveFrom: string } | null
  createdAt: string
  /** The lock token every change sends back. */
  updatedAt: string
}

/** One wording: plain text with {blanks}, used from effectiveFrom. */
export interface CoveringLetterWording {
  id: number
  effectiveFrom: string
  body: string
  addedBy: WordingAuthor
  createdAt: string
  status: WordingStatus
}

export interface CoveringLetter extends CoveringLetterSummary {
  /** Every wording, newest day first. */
  versions: CoveringLetterWording[]
}

/** POST /masters/covering-letters: the details and the first wording. */
export interface CoveringLetterBody {
  name: string
  visaTypeId: number
  party: CoveringLetterParty
  countryIds: number[]
  sortOrder: number
  body: string
  effectiveFrom: string
}

export interface DocumentMaster {
  id: number
  code: string
  name: string
  detail: string | null
  sortOrder: number
  isActive: boolean
  /** "Scan not saved" on a case's paper (0016 Decision 7). */
  warnIfNoScan: boolean
}

export interface Offering {
  id: number
  /** "France (Schengen) · Tourist" */
  label: string
  country: { id: number; code: string; name: string; zone: string | null; isActive: boolean }
  visaType: { id: number; code: string; name: string; isActive: boolean }
  isActive: boolean
  /** What "File ready" asks for (0007 Decision 6): both on by default, off for e-visas. */
  appointmentNeeded: boolean
  vendorNeeded: boolean
  /** The portal its cases open with Log in for me (0024 component 3); null when none is saved. */
  portal: { id: string; name: string } | null
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
    appointmentNeeded: boolean
    vendorNeeded: boolean
    /** The portal its cases open with Log in for me (0024 component 3). */
    portal: { id: string; name: string } | null
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

/** "Came in through" on the New enquiry form. Sources staff can't pick are set only by integrations. */
export interface EnquirySource {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
  staffSelectable: boolean
}

/** A plain dropdown value: a code and a name, switched off rather than deleted. */
export interface FollowUpOption {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

/** A follow-up "What happened" or "Next step", shown only in the departments it is tagged with (0018). */
export interface TaggedOption extends FollowUpOption {
  /** Department codes, in menu order. At least one. */
  departments: string[]
}

/** How fast the embassy processes the application: "Normal", "Express"… (0009). Picked on the quote. */
export type ProcessingSpeed = FollowUpOption

/** How a docket goes to the vendor: "Blue Dart", "By hand (no AWB)"… (0008 Decision 6). Picked at dispatch. */
/** Why a credit note is issued: "Wrong amount", "Recall"… (0011 Decision 5). Picked when an invoice is cancelled. */
export type CreditNoteReason = FollowUpOption

/** Why a file is taken back from the vendor: "Embassy taking too long"… (0011 Decision 6). Picked at the recall. */
export type RecallReason = FollowUpOption

/** Why a missing passport won't come back: "Embassy kept it"… (0013 Decision 5, amended). Picked when a shortfall is cleared. */
export type MissingPassportReason = FollowUpOption

/** What an additional invoice charges for: "Urgent submission", "Photos"… (0011 Decision 7). No GST. */
export type ExtraCharge = FollowUpOption

export interface Courier extends FollowUpOption {
  /** Off for "By hand": no slip (AWB) number is asked for */
  awbNeeded: boolean
}

/** Why a paper needs replacing in Step 3: "Not signed", "Wrong photo size"… (0007 Decision 3). */
export interface DocumentProblemReason {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

export type EnquiryReasonKind = 'POSTPONE' | 'CANCEL'

/** Why a case was postponed or cancelled, in the departments it is tagged with. The kind never changes. */
export interface EnquiryReason extends TaggedOption {
  kind: EnquiryReasonKind
}

/** A time slot for the collection and delivery boy (0015 Decision 2): "4–6 pm", 16:00–18:00 (IST). */
export interface FieldSlot extends FollowUpOption {
  startsAt: string
  endsAt: string
}

/** The small lists, by their API path. */
export type MasterResource =
  | 'countries'
  | 'visa-types'
  | 'embassies'
  | 'documents'
  | 'enquiry-sources'
  | 'follow-up-outcomes'
  | 'follow-up-next-steps'
  | 'enquiry-reasons'
  | 'vendors'
  | 'document-problem-reasons'
  | 'processing-speeds'
  | 'couriers'
  | 'credit-note-reasons'
  | 'recall-reasons'
  | 'missing-passport-reasons'
  | 'extra-charges'
  | 'field-slots'
  | 'field-fail-reasons'
