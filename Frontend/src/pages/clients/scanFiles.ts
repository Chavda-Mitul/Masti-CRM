import { fileSize, MB } from '../enquiries/case/pdfFiles'

// A scan for the client document vault (docs/decisions/0016-client-documents.md): a scanner's PDF or a phone photo.
// The server checks it again, by its first bytes.

export type ScanType = 'application/pdf' | 'image/jpeg' | 'image/png'

/** For the file picker. */
export const SCAN_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

const BY_EXTENSION: Record<string, ScanType> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

/** What the picked file is: its type, or its extension when the browser gives no usable type; null for anything else. */
export function scanType(file: File): ScanType | null {
  if (file.type === 'application/pdf' || file.type === 'image/jpeg' || file.type === 'image/png') return file.type
  return BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/** Why the picked file can't be uploaded (not a PDF, JPEG or PNG, empty, or over the limit), or null. */
export function scanProblem(file: File, maxMb: number) {
  if (!scanType(file)) return `${file.name} isn’t a PDF, JPEG or PNG. Save the scan as one of those and upload that.`
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > maxMb * MB) return `${file.name} is ${fileSize(file.size)}: the limit is ${maxMb} MB. Scan it at a lower resolution.`
  return null
}

/** "PDF · 3 pages · 1.2 MB", "JPEG · 820 KB" */
export function scanSummary(scan: { contentType: ScanType; pageCount: number | null; sizeBytes: number }) {
  const kind = scan.contentType === 'application/pdf' ? 'PDF' : scan.contentType === 'image/png' ? 'PNG' : 'JPEG'
  const pages = scan.pageCount === null ? '' : ` · ${scan.pageCount} ${scan.pageCount === 1 ? 'page' : 'pages'}`
  return `${kind}${pages} · ${fileSize(scan.sizeBytes)}`
}
