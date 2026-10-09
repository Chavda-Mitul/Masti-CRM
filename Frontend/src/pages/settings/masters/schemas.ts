import { z } from 'zod'

// Form validation for the system masters. Mirrors Backend/src/modules/holidays/holidays.schemas.ts and
// visaMasters/visaMasters.schemas.ts, so mistakes show up before saving; the backend checks everything again.
// Backend/tests/frontendRules.test.ts fails if these limits drift from the backend's.

/** A dated holiday covers at most this many days. */
export const MAX_RANGE_DAYS = 60
/** At most this many "Applies to" targets per holiday. */
export const MAX_TARGETS = 10
/** At most this many lines on a checklist. */
export const MAX_CHECKLIST_ITEMS = 60

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

export const documentFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Use letters, digits or underscores, e.g. BANK_STATEMENT_6M.'),
  name: required(150, 'Enter the document.'),
  detail: text(300),
  sortOrder,
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
