import { z } from 'zod'
import { istToday } from '../../lib/format'
import { normaliseMobile } from '../clients/schemas'
import type { CreateVisaCaseBody } from './types'

// The New enquiry form. Mirrors Backend/src/modules/visa/visa.schemas.ts so mistakes show before saving;
// the backend checks everything again.

/** Sanity limits, as on the backend (MAX_ADULTS, MAX_CHILDREN). */
export const MAX_ADULTS = 30
export const MAX_CHILDREN = 30

export const visaEnquiryFormSchema = z
  .object({
    mobile: z.string().refine((v) => normaliseMobile(v) !== null, 'Enter a valid 10-digit Indian mobile number.'),
    /** Asked only for a new number, or a client with no name yet; the page checks it then (the backend does too). */
    clientName: z.string().trim().max(150, 'Keep it under 150 characters.'),
    sourceCode: z.string().min(1, 'Pick where the enquiry came in.'),
    countryId: z.string().min(1, 'Choose a country.'),
    offeringId: z.string().min(1, 'Choose a visa type.'),
    adults: z.number().int().min(1, 'At least one adult travels.').max(MAX_ADULTS),
    children: z.number().int().min(0).max(MAX_CHILDREN),
    travelMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'Pick the travel month.')
      .refine((v) => v >= istToday().slice(0, 7), "The travel month can't be in the past."),
    travelDate: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.travelDate) return
    if (v.travelDate.slice(0, 7) !== v.travelMonth) {
      ctx.addIssue({ code: 'custom', path: ['travelDate'], message: 'The travel date must fall in the travel month.' })
    } else if (v.travelDate < istToday()) {
      ctx.addIssue({ code: 'custom', path: ['travelDate'], message: "The travel date can't be in the past." })
    }
  })

export type VisaEnquiryFormValues = z.infer<typeof visaEnquiryFormSchema>

export function emptyVisaEnquiry(mobile = ''): VisaEnquiryFormValues {
  return { mobile, clientName: '', sourceCode: '', countryId: '', offeringId: '', adults: 1, children: 0, travelMonth: '', travelDate: '' }
}

export function toCreateVisaCaseBody(v: VisaEnquiryFormValues): CreateVisaCaseBody {
  return {
    mobile: normaliseMobile(v.mobile) ?? v.mobile,
    clientName: v.clientName.trim() || null,
    sourceCode: v.sourceCode,
    offeringId: Number(v.offeringId),
    adults: v.adults,
    children: v.children,
    travelMonth: v.travelMonth,
    travelDate: v.travelDate || null,
  }
}
