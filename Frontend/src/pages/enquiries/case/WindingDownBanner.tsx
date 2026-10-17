import type { VisaCase } from '../types'
import { firstName, windingDown } from './labels'

/** What's left before the passports are back with the client, from where they are now. */
function stillToDo(c: VisaCase) {
  if (c.stage.code === 'AT_VENDOR') return 'are still with the vendor. Take the file back, then mark them received and hand them over'
  if (c.passportsReceived) return 'are in our stock. Hand them over'
  if (c.passportsBack) return 'are on their way back. Mark them received, then hand them over'
  return 'are still with the vendor. Record them on the way back, then mark them received and hand them over'
}

/**
 * The top of a cancelled case whose passports are still out (docs/decisions/0006-visa-documents.md amendment 15): only
 * their way back is left, and the case stays on its owner's list until they're handed back to the client.
 */
export function WindingDownBanner({ visaCase: c }: { visaCase: VisaCase }) {
  if (!windingDown(c)) return null
  return (
    <div className="alert alert-warn matured-banner" role="status">
      <span className="chip chip-bad">Cancelled{c.reason && ` · ${c.reason.name}`}</span>
      <span>
        The passports {stillToDo(c)} to the client. Until then this case stays on{' '}
        {c.owner ? <strong>{firstName(c.owner.name)}’s</strong> : 'the'} list.
      </span>
    </div>
  )
}
