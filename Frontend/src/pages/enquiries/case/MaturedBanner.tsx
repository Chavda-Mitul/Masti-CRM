import type { VisaCase } from '../types'
import { dayMonth } from './labels'

/**
 * The top of File preparation (demo screen 08 ⚠️, docs/decisions/0007-visa-file-prep.md Decision 2): "Matured 6 Oct —
 * All documents are in. Aarti handed the case to Neha Joshi in processing." Until the HOD picks a processor, it says so.
 */
export function MaturedBanner({ visaCase: c }: { visaCase: VisaCase }) {
  if (!c.maturedAt || c.stage.code !== 'FILE_PREPARATION') return null
  return (
    <div className="alert alert-ok matured-banner" role="status">
      <span className="chip chip-ok">Matured {dayMonth(c.maturedAt)}</span>
      <span>
        All documents are in.{' '}
        {c.owner ? (
          <>
            {c.maturedBy?.name ?? 'The follow-up desk'} handed the case to <strong>{c.owner.name}</strong> in processing.
          </>
        ) : (
          'Waiting for the HOD to pick a processor.'
        )}
      </span>
    </div>
  )
}
