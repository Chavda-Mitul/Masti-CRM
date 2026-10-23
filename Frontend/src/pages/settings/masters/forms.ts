// Small helpers shared by the masters forms (kept out of component files so fast refresh keeps working).

import type { DocumentMaster } from './types'

/** Target keys used by the holiday form: "ALL_EMBASSIES", "MASTI_OFFICE", "COUNTRY:3", "EMBASSY:5". */
export const countryKey = (id: number) => `COUNTRY:${id}`
export const embassyKey = (id: number) => `EMBASSY:${id}`

/** "" → null for optional text fields. */
export const orNull = (value: string) => value.trim() || null

/** "" → null, else the number, for optional number fields the form keeps as text. */
export const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value))

type UploadRules = Pick<
  DocumentMaster,
  | 'fileTypes'
  | 'minSize'
  | 'maxSize'
  | 'sizeUnit'
  | 'photoWidthMm'
  | 'photoHeightMm'
  | 'minWidthPx'
  | 'minHeightPx'
  | 'maxWidthPx'
  | 'maxHeightPx'
>

/** A photo's smallest and largest in pixels: "354×472–420×560 px", "400×514 px" (exact), "at least 600×750 px". */
function pixelsLabel(d: UploadRules) {
  const min = d.minWidthPx !== null && d.minHeightPx !== null ? `${d.minWidthPx}×${d.minHeightPx}` : null
  const max = d.maxWidthPx !== null && d.maxHeightPx !== null ? `${d.maxWidthPx}×${d.maxHeightPx}` : null
  if (min && max) return min === max ? `${min} px` : `${min}–${max} px`
  if (min) return `at least ${min} px`
  if (max) return `up to ${max} px`
  return null
}

/**
 * A document's sizes in its unit: "40–120 KB", "up to 0.3 MB", "from 40 KB". Given the shared largest scan (in MB),
 * a paper without its own max says it: "40 KB – 20 MB", "0.01–20 MB", "up to 20 MB".
 */
function sizeLabel(d: UploadRules, sharedMaxMb?: number) {
  const unit = d.sizeUnit
  if (d.minSize !== null && d.maxSize !== null) return `${d.minSize}–${d.maxSize} ${unit}`
  if (d.maxSize !== null) return `up to ${d.maxSize} ${unit}`
  if (sharedMaxMb === undefined) return d.minSize === null ? null : `from ${d.minSize} ${unit}`
  if (d.minSize === null) return `up to ${sharedMaxMb} MB`
  return unit === 'MB' ? `${d.minSize}–${sharedMaxMb} MB` : `${d.minSize} KB – ${sharedMaxMb} MB`
}

/** A document's upload rules in a line: "JPG, PNG · 40–120 KB · 35×45 mm · 600×600–1200×1200 px". */
export function uploadRulesLabel(d: UploadRules, sharedMaxMb?: number) {
  const photo = d.photoWidthMm !== null && d.photoHeightMm !== null ? `${d.photoWidthMm}×${d.photoHeightMm} mm` : null
  return [d.fileTypes.join(', '), sizeLabel(d, sharedMaxMb), photo, pixelsLabel(d)].filter(Boolean).join(' · ')
}
