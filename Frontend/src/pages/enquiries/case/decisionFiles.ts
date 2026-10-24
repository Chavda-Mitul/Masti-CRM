import { SCAN_ACCEPT, scanType } from '../../clients/scanFiles'
import type { VisaOutcome } from '../types'
import { fileSize, MB } from './pdfFiles'

// A traveller's file after the decision (docs/decisions/0012-visa-decision.md, amended 24 Oct 2026, change request 21,
// part 2): the refusal letter, the visa copy or the e-visa, as a scanner's PDF or a phone's JPEG or PNG. The server keeps
// a photo as a one-page PDF and checks the file again.

/** Which file a traveller gets: a refused one's refusal letter; an approved one's visa copy, or an e-visa's e-visa. */
export type DecisionFileKind = 'REFUSAL_LETTER' | 'VISA_COPY' | 'EVISA'

export const DECISION_FILE_LABEL: Record<DecisionFileKind, string> = {
  REFUSAL_LETTER: 'Refusal letter',
  VISA_COPY: 'Visa copy',
  EVISA: 'e-Visa',
}

/** The kind of file a traveller with this outcome gets: an e-visa (Submitted online) has its e-visa. */
export function decisionFileKind(outcome: VisaOutcome, online: boolean): DecisionFileKind {
  return outcome === 'REFUSED' ? 'REFUSAL_LETTER' : online ? 'EVISA' : 'VISA_COPY'
}

/** For the file picker: a PDF, JPG or PNG. */
export const DECISION_FILE_ACCEPT = SCAN_ACCEPT

/** The picked file's type, by its type or extension; null when it isn't a PDF, JPEG or PNG. */
export const decisionFileType = scanType

/** Why the picked file can't be uploaded (not a PDF, JPG or PNG, empty, or over the limit), or null. */
export function decisionFileProblem(file: File, maxMb: number) {
  if (!scanType(file)) return `${file.name} isn’t a PDF, JPG or PNG. Save it as one of those and upload that.`
  if (file.size === 0) return `${file.name} is empty. Pick the file again.`
  if (file.size > maxMb * MB) return `${file.name} is ${fileSize(file.size)}: the limit is ${maxMb} MB. Scan it at a lower resolution.`
  return null
}
