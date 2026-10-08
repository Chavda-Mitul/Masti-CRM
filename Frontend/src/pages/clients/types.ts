// Shapes returned by /api/clients (Backend/src/modules/clients/client.ts). Dates without a time are "YYYY-MM-DD".

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
  name: string | null
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

export interface ClientProfile {
  id: string
  kind: ClientKind
  mobile: string
  name: string | null
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
    clientName: string | null
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
