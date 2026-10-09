import { z } from 'zod'
import { istToday } from '../../lib/format'

// Form validation for the client screens. Mirrors Backend/src/modules/clients/clients.schemas.ts (and normaliseMobile
// in Backend/src/modules/auth/identifier.ts) so mistakes show up before saving. The backend checks everything again.
// Form values are the strings in the inputs; the payload builders in forms.ts turn them into the API body.

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "abcde 1234f" → "ABCDE1234F": how PAN, GSTIN and passport numbers are stored. */
export function compact(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

/** Indian mobile → "+91XXXXXXXXXX", or null. Accepts "98250 41234", "098250-41234", "+91 98250 41234". */
export function normaliseMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The 15th character of a GSTIN is a check character over the first 14. */
export function gstinChecksumOk(gstin: string): boolean {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36) === gstin.charAt(14)
}

const MOBILE_MESSAGE = 'Enter a valid 10-digit Indian mobile number.'
const blank = (value: string) => value.trim() === ''

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`)
const mobile = z.string().refine((v) => normaliseMobile(v) !== null, MOBILE_MESSAGE)
const optionalMobile = z.string().refine((v) => blank(v) || normaliseMobile(v) !== null, MOBILE_MESSAGE)
const optionalEmail = z.string().refine((v) => blank(v) || EMAIL_PATTERN.test(v.trim()), 'Enter a valid email address.')
const optionalPincode = z.string().refine((v) => blank(v) || PINCODE_PATTERN.test(v.trim()), 'Enter a 6-digit PIN code.')
const optionalPan = z.string().refine((v) => blank(v) || PAN_PATTERN.test(compact(v)), 'Enter a valid PAN, e.g. ABCDE1234F.')
const optionalGstin = z.string().superRefine((value, ctx) => {
  const gstin = compact(value)
  if (!gstin) return
  if (!GSTIN_PATTERN.test(gstin)) ctx.addIssue({ code: 'custom', message: 'Enter a valid 15-character GSTIN.' })
  else if (!gstinChecksumOk(gstin)) ctx.addIssue({ code: 'custom', message: "This GSTIN's last character doesn't match. Check it for a typo." })
})
const optionalPassport = z
  .string()
  .refine((v) => blank(v) || PASSPORT_PATTERN.test(compact(v)), 'Enter the passport number as printed (6–12 letters and digits).')

// ---------------------------------------------------------------------------
// Client details
// ---------------------------------------------------------------------------

const clientFields = {
  kind: z.enum(['INDIVIDUAL', 'CORPORATE']),
  /** Required for every client staff save (decided 9 Oct 2026). */
  name: text(150).min(1, "Enter the client's name."),
  contactPerson: text(150),
  email: optionalEmail,
  addressLine: text(300),
  area: text(100),
  city: text(100),
  /** Picked from the GST state list. */
  stateCode: z.string(),
  pincode: optionalPincode,
  pan: optionalPan,
  gstin: optionalGstin,
  accountingCode: text(50),
  /** Select values: an id as a string; "" = not set. */
  billingCycleId: z.string(),
  paymentHabitId: z.string(),
}

/** A GSTIN carries its holder's PAN in characters 3–12 (the backend refuses a mismatch). */
function panMatchesGstin(values: { pan: string; gstin: string }, ctx: z.RefinementCtx) {
  const pan = compact(values.pan)
  const gstin = compact(values.gstin)
  if (pan && GSTIN_PATTERN.test(gstin) && gstin.slice(2, 12) !== pan) {
    ctx.addIssue({ code: 'custom', path: ['pan'], message: `The PAN inside this GSTIN is ${gstin.slice(2, 12)}.` })
  }
}

/** One schema for adding and editing. When editing, the main number is shown read-only and changed from the Numbers card. */
export const clientFormSchema = z.object({ ...clientFields, mobile }).superRefine(panMatchesGstin)

export type ClientFormValues = z.infer<typeof clientFormSchema>

// ---------------------------------------------------------------------------
// Family members
// ---------------------------------------------------------------------------

export const memberFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter the name as printed in the passport.').max(150, 'Keep it under 150 characters.'),
  relationId: z.string().min(1, 'Pick a relation.'),
  dateOfBirth: z.string().refine((v) => !v || v <= istToday(), "Date of birth can't be in the future."),
  mobile: optionalMobile,
  passportNumber: optionalPassport,
  passportExpiry: z.string(),
})

export type MemberFormValues = z.infer<typeof memberFormSchema>

// ---------------------------------------------------------------------------
// Numbers and notes
// ---------------------------------------------------------------------------

export const phoneFormSchema = z.object({
  mobile,
  label: text(50),
})

export const mainNumberFormSchema = z.object({
  mobile,
  keepOldAsSecondary: z.boolean(),
})

export const noteFormSchema = z.object({
  body: z.string().trim().min(1, 'Write the note first.').max(2000, 'Keep it under 2,000 characters.'),
})

export type PhoneFormValues = z.infer<typeof phoneFormSchema>
export type MainNumberFormValues = z.infer<typeof mainNumberFormSchema>
export type NoteFormValues = z.infer<typeof noteFormSchema>
