import { formatDate, istParts } from '../../../../lib/format'

// Words the consent-wording screens share (kept out of component files so fast refresh keeps working).

/** "21 Oct 2026": the day a version came into use, in India. */
export const sinceDay = (iso: string) => formatDate(istParts(iso).date)
