import { fileSize, MB } from '../enquiries/case/pdfFiles'
import type { ScanFileType } from '../settings/masters/types'

// A scan for the client document vault (docs/decisions/0016-client-documents.md): a scanner's PDF or a phone photo,
// of a type and size its paper's upload rules take (Amendment 1). The server checks it again, by its first bytes, and
// a photo's shape and pixel size, which need its pixels.

export type ScanType = 'application/pdf' | 'image/jpeg' | 'image/png'

/** For the file picker. */
export const SCAN_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

const BY_EXTENSION: Record<string, ScanType> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

/** What the picked file is: its type, or its extension when the browser gives no usable type; null for anything else. */
export function scanType(file: File): ScanType | null {
  if (file.type === 'application/pdf' || file.type === 'image/jpeg' || file.type === 'image/png') return file.type
  return BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/** A scan's type as a paper's upload rules name it. */
const FILE_TYPE_OF: Record<ScanType, ScanFileType> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' }

/** A paper's upload rules (0016 Amendment 1). Null: no minimum, the shared largest scan, no photo shape, no pixel limits. */
export interface ScanRules {
  fileTypes: ScanFileType[]
  minSizeMb: number | null
  maxSizeMb: number | null
  photoWidthMm: number | null
  photoHeightMm: number | null
  minWidthPx: number | null
  minHeightPx: number | null
  maxWidthPx: number | null
  maxHeightPx: number | null
}

/** Before a paper is picked: any type, up to the shared largest scan. */
const ANY_PAPER: ScanRules = {
  fileTypes: ['PDF', 'JPG', 'PNG'],
  minSizeMb: null,
  maxSizeMb: null,
  photoWidthMm: null,
  photoHeightMm: null,
  minWidthPx: null,
  minHeightPx: null,
  maxWidthPx: null,
  maxHeightPx: null,
}

// The rules' messages, word for word Backend/src/modules/clients/clients.schemas.ts (Backend/tests/frontendRules.test.ts
// compares them). `what` names the paper, e.g. "Photos" in quotes.

/** "a PDF", "a JPG or PNG", "a PDF, JPG or PNG". */
export function fileTypesText(types: readonly ScanFileType[]) {
  return `a ${types.length > 1 ? `${types.slice(0, -1).join(', ')} or ${types.at(-1)}` : types[0]}`
}

/** A size in MB to 2 decimals: up for a file too big, down for one too small, so it never reads as the limit itself. */
function sizeText(bytes: number, round: 'up' | 'down') {
  const hundredths = (round === 'up' ? Math.ceil : Math.floor)((bytes / MB) * 100)
  return hundredths === 0 ? 'under 0.01 MB' : `${hundredths / 100} MB`
}

/** Why a file of this type and size can't be the paper's scan, or null. The largest is the paper's own, else the shared one. */
export function scanFileProblem(what: string, rules: ScanRules, sharedMaxMb: number, file: { type: ScanFileType; sizeBytes: number }) {
  if (!rules.fileTypes.includes(file.type)) {
    return `${what} must be ${fileTypesText(rules.fileTypes)}. This file is ${fileTypesText([file.type])}.`
  }
  const maxMb = rules.maxSizeMb ?? sharedMaxMb
  if (file.sizeBytes > maxMb * MB) {
    return `${what} can be at most ${maxMb} MB. This file is ${sizeText(file.sizeBytes, 'up')}: scan it at a lower resolution.`
  }
  if (rules.minSizeMb !== null && file.sizeBytes < rules.minSizeMb * MB) {
    return `${what} must be at least ${rules.minSizeMb} MB. This file is ${sizeText(file.sizeBytes, 'down')}: scan it at a higher resolution.`
  }
  return null
}

/**
 * Why the picked file can't be uploaded, or null: not a PDF, JPEG or PNG, empty, or a type or size its paper doesn't
 * take (before a paper is picked, any type up to the shared largest scan).
 */
export function scanProblem(file: File, paper: { name: string; rules: ScanRules } | null, sharedMaxMb: number) {
  const type = scanType(file)
  if (!type) return `${file.name} isn’t a PDF, JPEG or PNG. Save the scan as one of those and upload that.`
  if (file.size === 0) return `${file.name} is empty.`
  const what = paper ? `"${paper.name}"` : 'A scan'
  return scanFileProblem(what, paper?.rules ?? ANY_PAPER, sharedMaxMb, { type: FILE_TYPE_OF[type], sizeBytes: file.size })
}

/** "PDF · 3 pages · 1.2 MB", "JPEG · 820 KB" */
export function scanSummary(scan: { contentType: ScanType; pageCount: number | null; sizeBytes: number }) {
  const kind = scan.contentType === 'application/pdf' ? 'PDF' : scan.contentType === 'image/png' ? 'PNG' : 'JPEG'
  const pages = scan.pageCount === null ? '' : ` · ${scan.pageCount} ${scan.pageCount === 1 ? 'page' : 'pages'}`
  return `${kind}${pages} · ${fileSize(scan.sizeBytes)}`
}
