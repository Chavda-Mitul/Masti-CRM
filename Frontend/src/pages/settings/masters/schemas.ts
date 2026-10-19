import { z } from 'zod'
import { optionalEmail, optionalGstin, optionalMobile, optionalPan, optionalPersonName, panMatchesGstin } from '../../clients/schemas'

// Form validation for the system masters. Mirrors Backend/src/modules/holidays/holidays.schemas.ts,
// visaMasters/visaMasters.schemas.ts, vendors/vendors.schemas.ts and coveringLetters/coveringLetters.schemas.ts, so
// mistakes show up before saving; the backend checks everything again.
// Backend/tests/frontendRules.test.ts fails if these limits, or the covering letters' blanks, drift from the backend's.

/** A dated holiday covers at most this many days. */
export const MAX_RANGE_DAYS = 60
/** At most this many "Applies to" targets per holiday. */
export const MAX_TARGETS = 10
/** At most this many lines on a checklist. */
export const MAX_CHECKLIST_ITEMS = 60
/** At most this many countries per vendor. */
export const MAX_VENDOR_COUNTRIES = 50
/** At most this many countries per covering letter. */
export const MAX_LETTER_COUNTRIES = 50
/** The longest covering-letter wording, a page or two. */
export const MAX_LETTER_CHARS = 6000

/** Days from one date to another, counting both ends: 1 Oct → 7 Oct is 7. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
}

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`)
const required = (max: number, message: string) => text(max).min(1, message)
const isoDate = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

/** "One day" and "Several days" are both a dated holiday (repeat NONE); "Every week" is a weekly one. */
export type HolidayWhen = 'DAY' | 'RANGE' | 'WEEKLY'

export const holidayFormSchema = z
  .object({
    name: required(80, 'Give the holiday a name.'),
    when: z.enum(['DAY', 'RANGE', 'WEEKLY']),
    startDate: z.string(),
    endDate: z.string(),
    weekday: z.string(),
    /** Target keys: "ALL_EMBASSIES", "MASTI_OFFICE", "COUNTRY:3", "EMBASSY:5". */
    targets: z.array(z.string()).min(1, 'Pick what the holiday applies to.').max(MAX_TARGETS, `Pick at most ${MAX_TARGETS}.`),
    reference: text(300),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    // A weekly rule may leave its start empty: it then starts today.
    if (v.when !== 'WEEKLY' && !isoDate.test(v.startDate)) issue('startDate', 'Pick the date.')
    if (v.when === 'RANGE') {
      if (!isoDate.test(v.endDate)) issue('endDate', 'Pick the last day.')
      else if (isoDate.test(v.startDate) && v.endDate < v.startDate) issue('endDate', "The last day can't be before the first.")
      else if (isoDate.test(v.startDate) && daysInclusive(v.startDate, v.endDate) > MAX_RANGE_DAYS) {
        issue('endDate', `A holiday can cover at most ${MAX_RANGE_DAYS} days.`)
      }
    }
    if (v.when === 'WEEKLY') {
      if (!v.weekday) issue('weekday', 'Pick the day of the week.')
      if (v.endDate && isoDate.test(v.startDate) && v.endDate < v.startDate) issue('endDate', "The end can't be before the start.")
    }
  })

export type HolidayFormValues = z.infer<typeof holidayFormSchema>

export const holidaySettingsFormSchema = z.object({
  newForDays: z.number({ error: 'Enter a number of days.' }).int('Whole days only.').min(1, 'At least 1 day.').max(90, 'At most 90 days.'),
})

export type HolidaySettingsFormValues = z.infer<typeof holidaySettingsFormSchema>

const blankOk = (v: string) => v.trim() === ''
const upperCompact = (v: string) => v.replace(/\s+/g, '').toUpperCase()

/**
 * Masti's details (Backend company.schemas.ts, the same limits). Every field is a string in the form; blank means "not
 * set". The bank's fields go together: once one is filled in, the others it needs are too.
 */
export const companyDetailsFormSchema = z
  .object({
    name: required(100, 'Enter the company’s name.'),
    address: required(300, 'Enter the address.'),
    phone: required(30, 'Enter the phone number.'),
    phone2: z.string().trim().max(30, '30 characters at most.'),
    email: optionalEmail,
    website: z
      .string()
      .refine(
        (v) => blankOk(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')),
        'Enter a website like www.example.com.',
      ),
    pan: optionalPan,
    gstin: optionalGstin,
    stateCode: z.string(),
    accountName: z.string().trim().max(100, '100 characters at most.'),
    accountNo: z.string().refine((v) => blankOk(v) || /^[0-9]{6,20}$/.test(v.replace(/\s+/g, '')), '6–20 digits.'),
    bankName: z.string().trim().max(100, '100 characters at most.'),
    branch: z.string().trim().max(100, '100 characters at most.'),
    ifsc: z.string().refine((v) => blankOk(v) || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(upperCompact(v)), 'Enter an 11-character IFSC, e.g. ICIC0000584.'),
    swift: z.string().refine((v) => blankOk(v) || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(upperCompact(v)), 'Enter an 8- or 11-character SWIFT code.'),
  })
  .superRefine((v, ctx) => {
    panMatchesGstin(v, ctx)
    const bank = ['accountName', 'accountNo', 'bankName', 'branch', 'ifsc', 'swift'] as const
    if (bank.some((f) => v[f].trim() !== '')) {
      for (const f of ['accountName', 'accountNo', 'bankName', 'branch', 'ifsc'] as const) {
        if (v[f].trim() === '') ctx.addIssue({ code: 'custom', path: [f], message: 'Needed with the other bank details.' })
      }
    }
  })

export type CompanyDetailsFormValues = z.infer<typeof companyDetailsFormSchema>

/** The invoice series and GST rate (Backend visa.schemas.ts invoiceSettingSchema, the same limits). */
export const invoiceSettingFormSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,8}$/, 'Use 1–8 capital letters, e.g. MVI.'),
  digits: z.number({ error: 'Enter a number.' }).int('Whole digits only.').min(4, '4 at least.').max(12, '12 at most.'),
  startAt: z.number({ error: 'Enter a number.' }).int('A whole number.').min(1, '1 at least.').max(2_000_000_000),
  gstRatePercent: z
    .number({ error: 'Enter a rate.' })
    .min(0, '0 at least.')
    .max(28, '28 at most.')
    .refine((r) => Math.abs(r * 100 - Math.round(r * 100)) < 1e-9, 'At most 2 decimals.'),
  sac: z.string().trim().regex(/^\d{4,8}$/, '4–8 digits, e.g. 998559.'),
})

export type InvoiceSettingFormValues = z.infer<typeof invoiceSettingFormSchema>

/** The pending-document reminders (Backend visa.schemas.ts documentRemindersSchema, the same limits). */
export const documentRemindersFormSchema = z.object({
  enabled: z.boolean(),
  everyDays: z.number({ error: 'Enter a number.' }).int('Whole days only.').min(1, '1 day at least.').max(30, '30 days at most.'),
  sendAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 11:00.'),
  channel: z.enum(['WHATSAPP', 'SMS'], 'Pick WhatsApp or SMS.'),
})

export type DocumentRemindersFormValues = z.infer<typeof documentRemindersFormSchema>

const dayCount = z.number({ error: 'Enter a number.' }).int('Whole days only.').min(0, '0 at least.').max(30, '30 at most.')
const timeOfDay = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 11:00.')
const officeDayTiming = z.object({ afterDays: dayCount, at: timeOfDay })

/** The visa timings and the warnings' two values (Backend visa.schemas.ts visaSettingsSchema, the same limits). */
export const visaTimingsFormSchema = z.object({
  firstFollowUp: officeDayTiming,
  vendorConfirm: officeDayTiming,
  onlineCheck: officeDayTiming,
  submissionCheck: officeDayTiming,
  recallReturn: officeDayTiming,
  passportsBackCheck: officeDayTiming,
  arrivalCheck: officeDayTiming,
  assignCheck: officeDayTiming,
  handoverCheck: officeDayTiming,
  collectionCheck: z.object({ daysBefore: dayCount, at: timeOfDay }),
  passportValidity: z.object({
    monthsAfterReturn: z.number({ error: 'Enter a number.' }).int('Whole months only.').min(0, '0 at least.').max(24, '24 at most.'),
  }),
  childAge: z.object({ adultFrom: z.number({ error: 'Enter an age.' }).int('A whole age.').min(1, '1 at least.').max(25, '25 at most.') }),
})

export type VisaTimingsFormValues = z.infer<typeof visaTimingsFormSchema>

// ---------------------------------------------------------------------------
// Small master lists
// ---------------------------------------------------------------------------

const sortOrder = z.number({ error: 'Enter a number.' }).int('Whole numbers only.').min(0).max(9999)

export const countryFormSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use the 2-letter country code, e.g. FR.'),
  name: required(80, 'Enter the country.'),
  zone: text(40),
  sortOrder,
})
export type CountryFormValues = z.infer<typeof countryFormSchema>

export const visaTypeFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. BUSINESS.'),
  name: required(80, 'Enter the visa type.'),
  sortOrder,
})
export type VisaTypeFormValues = z.infer<typeof visaTypeFormSchema>

export const enquirySourceFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. JUSTDIAL.'),
  name: required(60, 'Enter the source.'),
  sortOrder,
  staffSelectable: z.boolean(),
})
export type EnquirySourceFormValues = z.infer<typeof enquirySourceFormSchema>

export const courierFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. BLUE_DART.'),
  name: required(80, 'Enter the courier.'),
  sortOrder,
  awbNeeded: z.boolean(),
})
export type CourierFormValues = z.infer<typeof courierFormSchema>

export const creditNoteReasonFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. WRONG_AMOUNT.'),
  name: required(80, 'Enter the reason.'),
  sortOrder,
})
export type CreditNoteReasonFormValues = z.infer<typeof creditNoteReasonFormSchema>

export const recallReasonFormSchema = creditNoteReasonFormSchema.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. EMBASSY_DELAY.'),
})
export type RecallReasonFormValues = z.infer<typeof recallReasonFormSchema>

export const missingPassportReasonFormSchema = creditNoteReasonFormSchema.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. EMBASSY_KEPT.'),
})
export type MissingPassportReasonFormValues = z.infer<typeof missingPassportReasonFormSchema>

export const extraChargeFormSchema = creditNoteReasonFormSchema.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. URGENT_SUBMISSION.'),
  name: required(80, 'Enter the charge.'),
})
export type ExtraChargeFormValues = z.infer<typeof extraChargeFormSchema>

const optionCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. NO_ANSWER.')

/**
 * A plain dropdown value (processing speed, why a visit fails), or a follow-up "What happened" / "Next step" with its
 * departments. Mirrors Backend/src/modules/enquiryMasters/enquiryMasters.schemas.ts.
 */
export const followUpOptionFormSchema = z.object({
  code: optionCode,
  name: required(80, 'Enter the wording staff will pick.'),
  sortOrder,
  departments: z.array(z.string()),
})
export type FollowUpOptionFormValues = z.infer<typeof followUpOptionFormSchema>

/** A follow-up or reason value shows only in the departments it is tagged with: at least one (0018). */
export const taggedOptionFormSchema = followUpOptionFormSchema.extend({
  departments: z.array(z.string()).min(1, 'Pick at least one department.'),
})

/** A postpone or cancel reason, with its departments. The kind is set once. */
export const enquiryReasonFormSchema = taggedOptionFormSchema.extend({
  kind: z.enum(['POSTPONE', 'CANCEL']),
})
export type EnquiryReasonFormValues = z.infer<typeof enquiryReasonFormSchema>

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time.')

/** A time slot for the collection and delivery boy (0015). Mirrors enquiryMasters.schemas.ts. */
export const fieldSlotFormSchema = z
  .object({
    code: optionCode,
    name: required(40, 'Enter the slot as staff will see it, e.g. 4–6 pm.'),
    startsAt: hhmm,
    endsAt: hhmm,
    sortOrder,
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ['endsAt'], message: 'The slot must end after it starts.' })
export type FieldSlotFormValues = z.infer<typeof fieldSlotFormSchema>

export const embassyFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Use 2–20 letters, digits or dashes, e.g. FR-MUM.'),
  countryId: z.string().min(1, 'Pick the country.'),
  name: required(120, 'Enter the name, e.g. French embassy, Mumbai.'),
  city: required(80, 'Enter the city.'),
  sortOrder,
})
export type EmbassyFormValues = z.infer<typeof embassyFormSchema>

/** Why a paper needs replacing in Step 3 (Backend visaMasters.schemas.ts createDocumentProblemReasonSchema). */
export const documentProblemFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. NOT_SIGNED.'),
  name: required(80, 'Enter what is wrong, e.g. Not signed.'),
  sortOrder,
})
export type DocumentProblemFormValues = z.infer<typeof documentProblemFormSchema>

/**
 * A visa submission agent (Backend/src/modules/vendors/vendors.schemas.ts). Contact details use the client forms' rules.
 * The email is required: the dispatch email goes to it (0008 Decision 8).
 */
export const vendorFormSchema = z.object({
  name: required(120, 'Enter the vendor’s name.'),
  city: required(80, 'Enter the city.'),
  countryIds: z
    .array(z.string())
    .min(1, 'Pick at least one country.')
    .max(MAX_VENDOR_COUNTRIES, `Pick at most ${MAX_VENDOR_COUNTRIES} countries.`),
  contactName: optionalPersonName(120),
  mobile: optionalMobile,
  email: optionalEmail.refine((v) => v.trim() !== '', 'Enter the vendor’s email: the dispatch email goes to it.'),
})
export type VendorFormValues = z.infer<typeof vendorFormSchema>

// ---------------------------------------------------------------------------
// Covering letters (docs/decisions/0019-covering-letters.md)
// ---------------------------------------------------------------------------

/**
 * The {blanks} a wording may use, in the backend's order, with what each prints. The examples are a made-up family (the
 * demo's Mehtas) for the preview; a case fills in its own when the letter is made.
 */
export const LETTER_BLANKS = [
  { token: 'date', label: 'The letter’s date', example: '20 October 2026' },
  { token: 'clientName', label: 'The client', example: 'Rakesh Mehta' },
  { token: 'clientAddress', label: 'The client’s address', example: '12 Shanti Park, Vesu, Surat 395007' },
  { token: 'applicant', label: 'The first traveller', example: 'Rakesh Mehta' },
  { token: 'passportNo', label: 'The first traveller’s passport no.', example: 'Z1234567' },
  { token: 'travellerNames', label: 'Every traveller, in a sentence', example: 'Rakesh Mehta, Anita Mehta, Aarav Mehta and Diya Mehta' },
  { token: 'travellerCount', label: 'How many travel', example: '4' },
  { token: 'travellers', label: 'The table of travellers, on a line of its own', example: '' },
  { token: 'country', label: 'The country', example: 'France' },
  { token: 'visaType', label: 'The visa type', example: 'Tourist' },
  { token: 'departOn', label: 'Travelling out', example: '10 December 2026' },
  { token: 'returnOn', label: 'Coming back', example: '21 December 2026' },
  { token: 'days', label: 'Days away', example: '12' },
  { token: 'entry', label: 'Single, double or multiple', example: 'single' },
  { token: 'hotel', label: 'The hotel stay', example: 'Hotel Lutetia, Paris' },
] as const

const BLANK = /\{([^{}]*)\}/g
const TOKENS: readonly string[] = LETTER_BLANKS.map((b) => b.token)

/** Windows line breaks become plain ones and the ends are trimmed, as the backend stores a wording. */
export function normaliseWording(body: string): string {
  return body.replace(/\r\n?/g, '\n').trim()
}

/** What's wrong with a wording's blanks, or null. Word for word the backend's messages. */
export function wordingProblem(body: string): string | null {
  const text = body.replace(/\r\n?/g, '\n')
  for (const [, blank] of text.matchAll(BLANK)) {
    if (!TOKENS.includes(blank!)) return `{${blank}} isn't one of the blanks. Pick blanks from the list.`
  }
  if (/[{}]/.test(text.replace(BLANK, ''))) return 'A { or } is left over. Blanks are written like {applicant}.'
  const travellers = text.match(/\{travellers\}/g)?.length ?? 0
  if (travellers > 1) return 'Use {travellers} only once: it prints the table of travellers.'
  if (travellers === 1 && !/^[ \t]*\{travellers\}[ \t]*$/m.test(text)) return 'Put {travellers} on a line of its own: it prints as a table.'
  return null
}

/** A covering letter's details: what it's called and which cases it fits. */
export const coveringLetterFormSchema = z.object({
  name: required(80, 'Give the letter a name.'),
  visaTypeId: z.string().min(1, 'Pick a visa type.'),
  party: z.enum(['ONE', 'SEVERAL'], 'Pick who travels.'),
  countryIds: z
    .array(z.string())
    .min(1, 'Pick at least one country.')
    .max(MAX_LETTER_COUNTRIES, `Pick at most ${MAX_LETTER_COUNTRIES} countries.`),
  sortOrder,
})
export type CoveringLetterFormValues = z.infer<typeof coveringLetterFormSchema>

/** A wording and the day it's used from. Today or later: the backend also keeps it within a year. */
export const wordingFormSchema = z.object({
  body: z.string().superRefine((value, ctx) => {
    const body = normaliseWording(value)
    const problem = !body
      ? 'Write the letter.'
      : body.length > MAX_LETTER_CHARS
        ? `Keep the letter under ${MAX_LETTER_CHARS} characters.`
        : wordingProblem(body)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
  effectiveFrom: z.string().regex(isoDate, 'Pick the day it’s used from.'),
})
export type WordingFormValues = z.infer<typeof wordingFormSchema>

export const documentFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. BANK_STATEMENT_6M.'),
  name: required(150, 'Enter the document.'),
  detail: text(300),
  sortOrder,
  warnIfNoScan: z.boolean(),
})
export type DocumentFormValues = z.infer<typeof documentFormSchema>

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

export const checklistLineSchema = z.object({
  documentId: z.number({ error: 'Pick a document.' }).int().positive('Pick a document.'),
  requirement: z.enum(['ORIGINAL', 'XEROX_OK', 'ARRANGED_BY_US']),
  appliesTo: z.enum(['ALL', 'ADULTS', 'CHILDREN']),
  quantity: z.number({ error: 'Enter how many.' }).int('Whole numbers only.').min(1, 'At least 1.').max(20, 'At most 20.'),
  note: text(200),
})

export const checklistFormSchema = z.object({
  items: z
    .array(checklistLineSchema)
    .min(1, 'A checklist needs at least one document.')
    .max(MAX_CHECKLIST_ITEMS, `At most ${MAX_CHECKLIST_ITEMS} documents.`)
    .superRefine((items, ctx) => {
      const seen = new Set<number>()
      items.forEach((item, i) => {
        if (seen.has(item.documentId)) {
          ctx.addIssue({ code: 'custom', path: [i, 'documentId'], message: 'This document is already on the list.' })
        }
        seen.add(item.documentId)
      })
    }),
})

export type ChecklistFormValues = z.infer<typeof checklistFormSchema>
export type ChecklistLineValues = z.infer<typeof checklistLineSchema>
