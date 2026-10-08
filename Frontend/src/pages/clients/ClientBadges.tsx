import { formatMonthYear } from '../../lib/format'
import type { PassportStatus, Readiness } from './types'

/** "Ready to invoice", or what is still missing (per the clients.invoiceReadiness setting). */
export function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  if (readiness.ready) return <span className="chip chip-ok">Ready to invoice</span>
  const labels = readiness.missing.map((m) => m.label)
  const text = labels.length <= 2 ? `Needs ${labels.join(' and ').toLowerCase()}` : `Needs ${labels.length} details`
  return (
    <span className="chip chip-warn" title={`Before invoicing, add: ${labels.join(', ')}`}>
      {text}
    </span>
  )
}

/** "Mar 2031", or a coloured "renew soon" / "expired" chip, as in the demo's Family & travellers table. */
export function PassportValidity({ expiry, status }: { expiry: string | null; status: PassportStatus | null }) {
  if (!expiry) return <span className="muted">—</span>
  if (status === 'EXPIRED') return <span className="chip chip-bad">{formatMonthYear(expiry)} · expired</span>
  if (status === 'RENEW_SOON') return <span className="chip chip-warn">{formatMonthYear(expiry)} · renew soon</span>
  return <span>{formatMonthYear(expiry)}</span>
}
