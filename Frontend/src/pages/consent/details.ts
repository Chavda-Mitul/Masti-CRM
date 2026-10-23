import { formatDate } from '../../lib/format'
import type { ConsentPerson } from './queries'

// The consent form's details as the client's page and the printed record show them (docs/decisions/0022-consent-form.md).
// Kept out of component files so fast refresh keeps working.

/** "21 Oct 2026, 3:45 pm" in Indian time. */
export function dateTimeWithYear(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
    .format(new Date(iso))
    .replace(/\bAM\b/i, 'am')
    .replace(/\bPM\b/i, 'pm')
}

const INDIAN_DIGITS = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** A date written out; a number past four digits (an income) with Indian commas, so a year stays as it is. */
function shown({ kind, value }: ConsentPerson['rows'][number]): string {
  if (kind === 'DATE') return formatDate(value)
  if (kind === 'NUMBER' && value.length > 4) return INDIAN_DIGITS.format(Number(value))
  return value
}

/**
 * The passport number, then the filled details in the form's order, as label and value (amendment 1). What doesn't
 * apply (a child's income) was left empty, so it isn't there.
 */
export function detailRows(p: ConsentPerson): [string, string][] {
  const rows: [string, string][] = p.passportNumber ? [['Passport number', p.passportNumber]] : []
  return [...rows, ...p.rows.map((r): [string, string] => [r.label, shown(r)])]
}
