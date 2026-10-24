import type { VisaOutcome } from '../types'

/** One traveller's entry in the decision forms, as typed. Record takes only the outcome; Change adds the details. */
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

/**
 * What's wrong before the row can be saved (Decision 3), or null. The server checks it again. Only the outcome is
 * needed: an approved one's number and dates are optional, added with Change (amended 23 Oct 2026), but the visa can't
 * end before it starts.
 */
export function rowProblem(r: DecisionRowValue) {
  if (!r.outcome) return 'Pick Approved or Refused.'
  if (r.outcome === 'APPROVED' && r.validFrom && r.validTo && r.validTo < r.validFrom) return 'It can’t end before it starts.'
  return null
}

/** The row as Change sends it: an approved one with its details, empty ones as null; a refused one without. */
export function rowBody(r: DecisionRowValue) {
  return r.outcome === 'APPROVED'
    ? { outcome: r.outcome, visaNo: r.visaNo.trim() || null, validFrom: r.validFrom || null, validTo: r.validTo || null }
    : { outcome: r.outcome! }
}
