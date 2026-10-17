/** "+919825041234" → "+91 98250 41234" */
export function formatMobile(mobile: string | null): string {
  if (!mobile) return ''
  const m = /^\+91(\d{5})(\d{5})$/.exec(mobile)
  return m ? `+91 ${m[1]} ${m[2]}` : mobile
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A date-only value "2027-06-15" → "Jun 2027" (no time zone shift). */
export function formatMonthYear(date: string | null): string {
  if (!date) return '—'
  const [y, m] = date.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`
}

/** A date-only value "2027-06-15" → "15 Jun 2027". */
export function formatDate(date: string | null): string {
  if (!date) return '—'
  const [y, m, d] = date.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''} ${y}`
}

/** Today in India as "2026-10-08", for date inputs and comparisons. */
export function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  )
}

/** A day (YYYY-MM-DD) moved by n days: addDays("2026-10-31", 1) → "2026-11-01". */
export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

/** A moment as the day and the time it is in India: { date: "2026-10-09", time: "10:30" }, to fill date and time inputs. */
export function istParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

/** "8 Oct, 4:12 pm" in Indian time. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
    .format(new Date(iso))
    .replace(/\bAM\b/i, 'am')
    .replace(/\bPM\b/i, 'pm')
}
