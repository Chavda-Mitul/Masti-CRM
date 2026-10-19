// Shapes returned by /api/clients (Backend/src/modules/clients/client.ts). Dates without a time are "YYYY-MM-DD".

import type { EnquiryStatus } from '../enquiries/types'
import type { ScanType } from './scanFiles'

export type ClientKind = 'INDIVIDUAL' | 'CORPORATE'
export type PassportStatus = 'VALID' | 'RENEW_SOON' | 'EXPIRED'

/** The client fields "complete before invoicing" can require. */
export type ReadinessField =
  | 'name'
  | 'contactPerson'
  | 'email'
  | 'addressLine'
  | 'area'
  | 'city'
  | 'stateCode'
  | 'pincode'
  | 'pan'
  | 'gstin'
  | 'accountingCode'

export interface Readiness {
  ready: boolean
  missing: { field: ReadinessField; label: string }[]
}

export interface Lookup {
  id: number
  code: string
  name: string
}

export interface ClientSummary {
  id: string
  kind: ClientKind
  name: string
  contactPerson: string | null
  mobile: string
  area: string | null
  city: string | null
  accountingCode: string | null
  readiness: Readiness
}

export interface ClientPhone {
  id: string
  mobile: string
  label: string | null
  createdAt: string
}

export interface ClientMember {
  id: string
  clientId: string
  name: string
  relation: Lookup | null
  dateOfBirth: string | null
  age: number | null
  mobile: string | null
  passportNumber: string | null
  passportExpiry: string | null
  passportStatus: PassportStatus | null
  archivedAt: string | null
  updatedAt: string
}

export interface ClientNote {
  id: string
  body: string
  author: { id: string; name: string }
  createdAt: string
}

/** One scan in the client document vault (docs/decisions/0016-client-documents.md). */
export interface ClientDocumentScan {
  id: string
  fileName: string
  contentType: ScanType
  sizeBytes: number
  /** A PDF's pages; null for a photo. */
  pageCount: number | null
  uploadedAt: string
  uploadedBy: { id: string; name: string }
}

/** A paper from the document master: Passport, Aadhaar card… */
export interface Paper {
  id: number
  name: string
}

/** One person's scans (no member: the client's own papers), each paper with its current scan and the older ones. */
export interface ClientDocumentGroup {
  member: { id: string; name: string; relation: string; archived: boolean } | null
  papers: { paper: Paper; current: ClientDocumentScan; older: ClientDocumentScan[] }[]
}

/** The whole vault, for HODs and the Head: the groups, the papers a scan can be, and the largest scan. */
export interface ClientDocuments {
  groups: ClientDocumentGroup[]
  papers: Paper[]
  maxMb: number
}

export interface ClientProfile {
  id: string
  kind: ClientKind
  mobile: string
  name: string
  contactPerson: string | null
  email: string | null
  addressLine: string | null
  area: string | null
  city: string | null
  stateCode: string | null
  pincode: string | null
  pan: string | null
  gstin: string | null
  accountingCode: string | null
  billingCycle: Lookup | null
  paymentHabit: Lookup | null
  clientSince: string
  createdAt: string
  updatedAt: string
  readiness: Readiness
  phones: ClientPhone[]
  members: ClientMember[]
  notes: ClientNote[]
  /** Every case this user may open: unfinished first, then finished; newest first in each. */
  cases: ClientCase[]
}

/** A row of "Everything we've done for this family". */
export interface ClientCase {
  caseNo: string
  /** Department code, e.g. "VISA" */
  department: string
  /** "France (Schengen) · Tourist · 2 adults, 2 children" */
  summary: string
  status: EnquiryStatus
  /** The step's name ("Documents") and its own status label ("Delivered" once a visa case is closed). */
  stage: { name: string; statusLabel: string }
  /** Why it was postponed, cancelled or lost. */
  reason: { name: string } | null
  resumeOn: string | null
  /** A cancelled visa case whose passports are still to hand back. */
  toHandBack: boolean
  /** Whose case it is. Null while it waits for the HOD (e.g. matured, no processor yet). */
  owner: { id: string; name: string } | null
}

export interface ClientOptions {
  kinds: ClientKind[]
  billingCycles: (Lookup & { isDefault: boolean })[]
  paymentHabits: Lookup[]
  relations: Lookup[]
  states: { code: string; name: string }[]
}

export interface ClientListPage {
  clients: ClientSummary[]
  nextCursor: string | null
}

export interface ClientListFilters {
  q: string
  kind: ClientKind | ''
  /** '' = all, 'true' = missing details, 'false' = ready to invoice */
  incomplete: '' | 'true' | 'false'
}

/** One field that matched records already on file (409 DUPLICATE). */
export interface Duplicate {
  field: 'mobile' | 'pan' | 'gstin' | 'passportNumber'
  value: string
  matches: {
    clientId: string
    clientName: string
    clientMobile: string
    memberId?: string
    memberName?: string
  }[]
}

// Request bodies. Optional keys are left out when not changed; null clears a field.

export interface ClientFieldsBody {
  kind?: ClientKind
  name?: string | null
  contactPerson?: string | null
  email?: string | null
  addressLine?: string | null
  area?: string | null
  city?: string | null
  stateCode?: string | null
  pincode?: string | null
  pan?: string | null
  gstin?: string | null
  accountingCode?: string | null
  billingCycleId?: number
  paymentHabitId?: number | null
  confirmDuplicates?: boolean
}

export type CreateClientBody = ClientFieldsBody & { mobile: string }
export type UpdateClientBody = ClientFieldsBody & { updatedAt: string }

export interface MemberBody {
  name?: string
  relationId?: number
  dateOfBirth?: string | null
  mobile?: string | null
  passportNumber?: string | null
  passportExpiry?: string | null
  updatedAt?: string
  confirmDuplicates?: boolean
}
