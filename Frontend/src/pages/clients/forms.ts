import { formatMobile } from '../../lib/format'
import { compact, normaliseMobile, type ClientFormValues, type MemberFormValues } from './schemas'
import type { ClientFieldsBody, ClientMember, ClientOptions, ClientProfile, MemberBody } from './types'

// Between API records and form values (strings), and from form values to request bodies.
// Creating sends only filled-in fields; editing sends only the fields the user changed (react-hook-form's dirtyFields),
// so an untouched field can never overwrite someone else's change and unchanged Accounts fields aren't sent.

/** Which form fields go into the body. */
type Include<T> = (field: keyof T) => boolean

export function clientFormDefaults(client: ClientProfile | null, options: ClientOptions): ClientFormValues {
  const defaultCycle = options.billingCycles.find((c) => c.isDefault)
  return {
    kind: client?.kind ?? 'INDIVIDUAL',
    mobile: client ? formatMobile(client.mobile) : '',
    name: client?.name ?? '',
    contactPerson: client?.contactPerson ?? '',
    email: client?.email ?? '',
    addressLine: client?.addressLine ?? '',
    area: client?.area ?? '',
    city: client?.city ?? '',
    stateCode: client?.stateCode ?? '',
    pincode: client?.pincode ?? '',
    pan: client?.pan ?? '',
    gstin: client?.gstin ?? '',
    accountingCode: client?.accountingCode ?? '',
    billingCycleId: String(client?.billingCycle?.id ?? defaultCycle?.id ?? ''),
    paymentHabitId: client?.paymentHabit ? String(client.paymentHabit.id) : '',
  }
}

const orNull = (value: string) => value.trim() || null

export function clientBody(values: ClientFormValues, include: Include<ClientFormValues>, canEditAccounts: boolean): ClientFieldsBody {
  const body: ClientFieldsBody = {}
  if (include('kind')) body.kind = values.kind
  if (include('name')) body.name = orNull(values.name)
  if (include('contactPerson') && values.kind === 'CORPORATE') body.contactPerson = orNull(values.contactPerson)
  if (include('email')) body.email = orNull(values.email)
  if (include('addressLine')) body.addressLine = orNull(values.addressLine)
  if (include('area')) body.area = orNull(values.area)
  if (include('city')) body.city = orNull(values.city)
  if (include('stateCode')) body.stateCode = values.stateCode || null
  if (include('pincode')) body.pincode = orNull(values.pincode)
  if (include('pan')) body.pan = compact(values.pan) || null
  if (include('gstin')) body.gstin = compact(values.gstin) || null
  // The backend refuses Accounts fields from anyone else, so they're never sent.
  if (canEditAccounts) {
    if (include('accountingCode')) body.accountingCode = orNull(values.accountingCode)
    if (include('billingCycleId') && values.billingCycleId) body.billingCycleId = Number(values.billingCycleId)
    if (include('paymentHabitId')) body.paymentHabitId = values.paymentHabitId ? Number(values.paymentHabitId) : null
  }
  return body
}

/** For a new record: only fields with something in them. */
export function filledIn<T extends Record<string, unknown>>(values: T): Include<T> {
  return (field) => {
    const value = values[field]
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined
  }
}

/** For an edit: only fields the user changed. */
export function changedIn<T>(dirtyFields: Partial<Record<keyof T, unknown>>): Include<T> {
  return (field) => Boolean(dirtyFields[field])
}

export function memberFormDefaults(member: ClientMember | null): MemberFormValues {
  return {
    name: member?.name ?? '',
    relationId: member?.relation ? String(member.relation.id) : '',
    dateOfBirth: member?.dateOfBirth ?? '',
    mobile: member?.mobile ? formatMobile(member.mobile) : '',
    passportNumber: member?.passportNumber ?? '',
    passportExpiry: member?.passportExpiry ?? '',
  }
}

export function memberBody(values: MemberFormValues, include: Include<MemberFormValues>): MemberBody {
  const body: MemberBody = {}
  if (include('name')) body.name = values.name.trim()
  if (include('relationId')) body.relationId = Number(values.relationId)
  if (include('dateOfBirth')) body.dateOfBirth = values.dateOfBirth || null
  if (include('mobile')) body.mobile = values.mobile.trim() ? normaliseMobile(values.mobile) : null
  if (include('passportNumber')) body.passportNumber = compact(values.passportNumber) || null
  if (include('passportExpiry')) body.passportExpiry = values.passportExpiry || null
  return body
}
