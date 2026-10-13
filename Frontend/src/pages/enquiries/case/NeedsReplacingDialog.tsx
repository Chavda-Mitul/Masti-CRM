import { useState } from 'react'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useCheckCaseDocument } from '../queries'
import type { CaseDocument } from '../types'

/**
 * Flags a paper as needing replacing (docs/decisions/0007-visa-file-prep.md Decision 3), with a reason from Settings →
 * Masters → Document problems. The processor sorts it out with the client and marks the new one Checked.
 */
export function NeedsReplacingDialog({
  caseNo,
  doc,
  travellerName,
  onClose,
}: {
  caseNo: string
  doc: CaseDocument
  travellerName: string
  onClose: () => void
}) {
  const toast = useToast()
  const reasons = useMasterList('document-problem-reasons')
  const check = useCheckCaseDocument(caseNo)
  const options = (reasons.data ?? []).filter((r) => r.isActive)
  // The current reason, if it is still offered.
  const current = doc.checkReason && options.some((r) => r.id === doc.checkReason!.id) ? String(doc.checkReason.id) : ''
  const [reasonId, setReasonId] = useState(current)
  const [error, setError] = useState('')

  const submit = () => {
    if (!reasonId) {
      setError('Pick what’s wrong with it.')
      return
    }
    setError('')
    check.mutate(
      { documentId: doc.id, check: 'NEEDS_REPLACING', reasonId: Number(reasonId) },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `${doc.name} flagged: needs replacing.` })
          onClose()
        },
        onError: (err) => setError(errorBody(err)?.issues?.reasonId?.[0] ?? ''),
      },
    )
  }

  const message = error ? null : errorText(check.error)

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="replace-title">
          Needs replacing: {doc.name}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          For {travellerName}. Ask the client for a new one; when it comes in, mark it Checked.
        </p>

        <label className="field">
          <span className="lbl">What’s wrong with it</span>
          <select
            className="select"
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
            disabled={reasons.isPending}
            autoFocus
            aria-invalid={!!error || undefined}
          >
            <option value="">{reasons.isPending ? 'Loading…' : 'Pick a reason…'}</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {error && <span className="field-error">{error}</span>}
          <span className="hint">Fixed reasons only — no free text anywhere.</span>
        </label>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={check.isPending} onClick={submit}>
            {check.isPending ? 'Saving…' : 'Needs replacing'}
          </button>
        </div>
      </div>
    </div>
  )
}
