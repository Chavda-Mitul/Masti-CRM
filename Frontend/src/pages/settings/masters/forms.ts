// Small helpers shared by the masters forms (kept out of component files so fast refresh keeps working).

import type { DocumentMaster } from './types'

/** Target keys used by the holiday form: "ALL_EMBASSIES", "MASTI_OFFICE", "COUNTRY:3", "EMBASSY:5". */
export const countryKey = (id: number) => `COUNTRY:${id}`
export const embassyKey = (id: number) => `EMBASSY:${id}`

/** "" → null for optional text fields. */
export const orNull = (value: string) => value.trim() || null

/** "" → null, else the number, for optional number fields the form keeps as text. */
export const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value))

type UploadRules = Pick<DocumentMaster, 'fileTypes' | 'minSizeMb' | 'maxSizeMb' | 'photoWidthMm' | 'photoHeightMm'>

/** A document's upload rules in a line: "JPG, PNG · 0.01–0.3 MB · 35×45 mm". */
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
  return [d.fileTypes.join(', '), size, photo].filter(Boolean).join(' · ')
}
