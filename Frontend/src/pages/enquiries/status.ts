import { formatDate } from '../../lib/format'

/** What a postponed or cancelled case shows instead of its next step: "Postponed to 2 Nov 2026 · Travel dates moved". */
export function statusNote(c: { status: string; reason: { name: string } | null; resumeOn: string | null }): string | null {
  const why = c.reason ? ` · ${c.reason.name}` : ''
  if (c.status === 'POSTPONED') return `Postponed to ${formatDate(c.resumeOn)}${why}`
  if (c.status === 'CANCELLED') return `Cancelled${why}`
  return null
}
