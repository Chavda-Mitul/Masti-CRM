import { formatDate } from '../../lib/format'

/**
 * What a case shows instead of its next step when it is waiting: "Postponed to 2 Nov 2026 · Travel dates moved",
 * "Cancelled · Trip cancelled", or for an open case nobody owns: "Matured · assign a processor", or "No owner · assign
 * someone" before maturity (a leaver's case, docs/decisions/0002-user-types.md amendment 1). A cancelled visa case
 * whose passports are still out adds "passports still to hand back" (0006 amendment 15).
 */
export function statusNote(c: {
  status: string
  reason: { name: string } | null
  resumeOn: string | null
  owner?: unknown
  toHandBack?: boolean
  matured?: boolean
}): string | null {
  const why = c.reason ? ` · ${c.reason.name}` : ''
  if (c.status === 'POSTPONED') return `Postponed to ${formatDate(c.resumeOn)}${why}`
  if (c.status === 'CANCELLED') return `Cancelled${why}${c.toHandBack ? ' · passports still to hand back' : ''}`
  if (c.status === 'CLOSED') return 'Closed'
  if (c.status === 'OPEN' && c.owner === null) return c.matured ? 'Matured · assign a processor' : 'No owner · assign someone'
  return null
}
