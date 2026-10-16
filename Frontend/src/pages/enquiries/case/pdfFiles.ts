// Scanned PDFs kept with a case: the final file (0007 Decision 8) and a refused traveller's refusal letter (0012
// Decision 4). The server checks them again.

export const MB = 1024 * 1024

/** "12.4 MB", "820 KB" */
export function fileSize(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

/** Why the picked file can't be uploaded (not a PDF, or over the limit), or null. */
export function pdfProblem(file: File, maxMb: number) {
  if (!isPdf(file)) return `${file.name} isn’t a PDF. Save the scan as a PDF and upload that.`
  if (file.size > maxMb * MB) return `${file.name} is ${fileSize(file.size)}: the limit is ${maxMb} MB. Scan it at a lower resolution.`
  return null
}
