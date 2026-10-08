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
