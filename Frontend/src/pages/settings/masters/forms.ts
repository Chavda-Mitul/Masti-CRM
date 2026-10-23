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
  'fileTypes' | 'minSizeMb' | 'maxSizeMb' | 'photoWidthMm' | 'photoHeightMm' | 'minWidthPx' | 'minHeightPx' | 'maxWidthPx' | 'maxHeightPx'
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

/** A document's upload rules in a line: "JPG, PNG · 0.01–0.3 MB · 35×45 mm · 600×600–1200×1200 px". */
export function uploadRulesLabel(d: UploadRules) {
  const size =
    d.minSizeMb !== null && d.maxSizeMb !== null
      ? `${d.minSizeMb}–${d.maxSizeMb} MB`
      : d.maxSizeMb !== null
        ? `up to ${d.maxSizeMb} MB`
        : d.minSizeMb !== null
          ? `from ${d.minSizeMb} MB`
          : null
  const photo = d.photoWidthMm !== null && d.photoHeightMm !== null ? `${d.photoWidthMm}×${d.photoHeightMm} mm` : null
  return [d.fileTypes.join(', '), size, photo, pixelsLabel(d)].filter(Boolean).join(' · ')
}
