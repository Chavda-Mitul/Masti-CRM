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

/** GET /api/company/details: Masti's own details, the "From" on the parcel sticker (0008 Decision 5). */
export interface CompanyDetails {
  name: string
  address: string
  phone: string
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
  email: string | null
  isActive: boolean
  /** The countries it submits files for, by name. */
  countries: { id: number; code: string; name: string; zone: string | null }[]
  createdAt: string
  updatedAt: string
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
  /** What "File ready" asks for (0007 Decision 6): both on by default, off for e-visas. */
  appointmentNeeded: boolean
  vendorNeeded: boolean
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

/** A follow-up "What happened" or "Next step" (shared by every department). */
export interface FollowUpOption {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

/** How fast the embassy processes the application: "Normal", "Express"… (0009). Picked on the quote. */
export type ProcessingSpeed = FollowUpOption

/** Why a paper needs replacing in Step 3: "Not signed", "Wrong photo size"… (0007 Decision 3). */
export interface DocumentProblemReason {
  id: number
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

export type EnquiryReasonKind = 'POSTPONE' | 'CANCEL'

/** Why a case was postponed or cancelled. The kind never changes. */
export interface EnquiryReason extends FollowUpOption {
  kind: EnquiryReasonKind
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
