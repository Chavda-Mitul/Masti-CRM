import type { CoveringLetterFormValues } from '../schemas'
import type { CoveringLetterSummary } from '../types'

// Between a covering letter and its details form (kept out of component files so fast refresh keeps working).

/** The form's starting values: the letter's, or a new letter's (most letters are for families). */
export function detailsDefaults(letter: CoveringLetterSummary | null): CoveringLetterFormValues {
  return {
    name: letter?.name ?? '',
    visaTypeId: letter ? String(letter.visaType.id) : '',
    party: letter?.party ?? 'SEVERAL',
    countryIds: letter?.countries.map((c) => String(c.id)) ?? [],
    sortOrder: letter?.sortOrder ?? 0,
  }
}

/** What the API takes. */
export function detailsBody(values: CoveringLetterFormValues) {
  return {
    name: values.name.trim(),
    visaTypeId: Number(values.visaTypeId),
    party: values.party,
    countryIds: values.countryIds.map(Number),
    sortOrder: values.sortOrder,
  }
}

/** The fields the API may name in a 400, per form. */
export const DETAILS_FIELDS = ['name', 'visaTypeId', 'party', 'countryIds', 'sortOrder'] as const
export const WORDING_FIELDS = ['body', 'effectiveFrom'] as const
