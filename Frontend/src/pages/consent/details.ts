import { formatDate } from '../../lib/format'
import type { ConsentPerson } from './queries'

// The consent form's details as the client's page and the printed record show them (docs/decisions/0022-consent-form.md).
// Kept out of component files so fast refresh keeps working.

const WHOLE_RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

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

/** The filled details in the form's order; what doesn't apply (a child's income) stays out. */
export function detailRows(p: ConsentPerson): [string, string][] {
  const day = (value: string | null) => (value ? formatDate(value) : null)
  const rows: [string, string | null][] = [
    ['Passport number', p.passportNumber],
    ['Date of birth', day(p.dateOfBirth)],
    ['Spouse’s date of birth', day(p.spouseDateOfBirth)],
    ['Anniversary', day(p.anniversary)],
    ['Mother’s date of birth', day(p.motherDateOfBirth)],
    ['Father’s date of birth', day(p.fatherDateOfBirth)],
    ['Home address', p.residentialAddress],
    ['Office address', p.officeAddress],
    ['Profession', p.profession],
    ['Annual income', p.annualIncome === null ? null : WHOLE_RUPEES.format(p.annualIncome)],
    ['Education', p.education],
  ]
  return rows.filter((row): row is [string, string] => !!row[1])
}
