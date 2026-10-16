import type { VisaOutcome } from '../types'

/** One traveller's entry in the decision forms, as typed. */
export interface DecisionRowValue {
  outcome: VisaOutcome | null
  visaNo: string
  validFrom: string
  validTo: string
}

export const emptyRow: DecisionRowValue = { outcome: null, visaNo: '', validFrom: '', validTo: '' }

/** "Sticker no.", or "e-Visa no." for an e-visa (docs/decisions/0012-visa-decision.md Decision 5). */
export const numberLabel = (online: boolean) => (online ? 'e-Visa no.' : 'Sticker no.')

/** "sticker number" / "e-visa number", for the messages. */
export const numberWords = (online: boolean) => (online ? 'e-visa number' : 'sticker number')

/** What's missing before the row can be saved (Decision 3), or null. The server checks it again. */
export function rowProblem(r: DecisionRowValue, online: boolean) {
  if (!r.outcome) return 'Pick Approved or Refused.'
  if (r.outcome === 'REFUSED') return null
  if (!r.visaNo.trim()) return `Enter the ${numberWords(online)}.`
  if (!r.validFrom || !r.validTo) return 'Enter both dates.'
  if (r.validTo < r.validFrom) return 'It can’t end before it starts.'
  return null
}

/** The row as the API takes it: an approved one with its number and dates, a refused one without. */
export function rowBody(r: DecisionRowValue) {
  return r.outcome === 'APPROVED'
    ? { outcome: r.outcome, visaNo: r.visaNo, validFrom: r.validFrom, validTo: r.validTo }
    : { outcome: r.outcome! }
}
