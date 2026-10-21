import { useState } from 'react'
import { RequiredMark } from '../../../components/FormField'
import { errorBody, errorText, isStale } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { useChangeDecision } from '../queries'
import type { CaseTraveller, StickerCheck, VisaCase } from '../types'
import { DecisionRow } from './DecisionRow'
import { rowBody, rowProblem, type DecisionRowValue } from './decisionValues'

/**
 * "Change" on one traveller's row of the Decision card (docs/decisions/0012-visa-decision.md Decision 6), while the case
 * is at Step 6, or at Step 7 until the handover: the outcome, or just the number or dates. Once the passports are
 * received, an approved traveller's sticker is checked again, as at Mark received (amended 19 Oct 2026). It's checked
 * as when recorded, and the audit log keeps the old and new values. A save after someone else's change is refused
 * (STALE), so it can't undo theirs.
 */
export function ChangeDecisionDialog({ visaCase: c, traveller: t, onClose }: { visaCase: VisaCase; traveller: CaseTraveller; onClose: () => void }) {
  const toast = useToast()
  const change = useChangeDecision(c.caseNo)
  // A number already on another case, or visa dates that don't cover the trip: check, then save anyway.
  const guard = useWarningGuard()
  const online = !!c.submittedOnline
  const name = t.name ?? t.label
  const was: DecisionRowValue = {
    outcome: t.decision?.outcome ?? null,
    visaNo: t.decision?.visaNo ?? '',
    validFrom: t.decision?.validFrom ?? '',
    validTo: t.decision?.validTo ?? '',
  }
  const [row, setRow] = useState(was)
  const [error, setError] = useState<string | undefined>()
  // The case as it was when the dialog opened: the page refetches while it's open (another window, a colleague), and
  // the save must not carry the new updatedAt over a form filled in from the old values.
  const [openedAt] = useState(c.updatedAt)
  // Received: the sticker is checked again against the passport, starting from what Mark received recorded.
  const [sticker, setSticker] = useState<StickerCheck | null>(t.stickerCheck)
  const checking = !!c.passportsReceived && row.outcome === 'APPROVED'

  const press = () => {
    const problem = rowProblem(row, online) ?? (checking && !sticker ? 'Check the sticker against the passport: Matches or Doesn’t match.' : null)
    setError(problem ?? undefined)
    if (problem) return
    const body = rowBody(row)
    const same =
      body.outcome === was.outcome &&
      (body.outcome === 'REFUSED' || (row.visaNo.trim().replace(/\s+/g, ' ').toUpperCase() === was.visaNo && row.validFrom === was.validFrom && row.validTo === was.validTo))
    if (same && (!checking || sticker === t.stickerCheck)) return onClose()
    const send = (confirmWarnings: boolean) =>
      change.mutate(
        {
          travellerId: t.id,
          ...body,
          ...(checking && sticker ? { stickerCheck: sticker } : {}),
          updatedAt: openedAt,
          ...(confirmWarnings ? { confirmWarnings } : {}),
        },
        {
          onSuccess: () => {
            toast({ tone: 'ok', message: `${name}’s decision is changed: ${body.outcome === 'APPROVED' ? 'Approved' : 'Refused'}.` })
            onClose()
          },
          onError: (err) => {
            // Someone else changed the case (the case is reloaded, with a warning): reopening fills the form in afresh.
            if (isStale(err)) return onClose()
            guard.intercept(err, () => send(true))
          },
        },
      )
    send(false)
  }
  const issues = errorBody(change.error)?.issues
  const issue = issues?.decision?.[0] ?? issues?.visaNo?.[0] ?? issues?.validFrom?.[0] ?? issues?.validTo?.[0] ?? issues?.outcome?.[0]
  const message = issue ? null : errorText(change.error)

  return (
    <>
      <div className="overlay overlay-center" onClick={onClose}>
        <div className="dialog decision-dialog" role="dialog" aria-modal="true" aria-labelledby="change-decision-title" onClick={(e) => e.stopPropagation()}>
          <h2 className="h2" id="change-decision-title">
            Change the decision
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Correct the outcome, or the {online ? 'e-visa' : 'sticker'} number and dates. The change is kept in the case’s history.
          </p>

          <DecisionRow
            name={name}
            row={row}
            online={online}
            disabled={change.isPending}
            error={error ?? issue}
            onChange={(patch) => {
              setRow({ ...row, ...patch })
              setError(undefined)
              change.reset()
            }}
          />
          {checking && (
            <div className="decision-row">
              <span>
                <strong>The sticker</strong>
                <RequiredMark />
                <span className="muted small" style={{ display: 'block' }}>
                  Against the passport, as at Mark received
                </span>
              </span>
              <span className="seg-btn" role="radiogroup" aria-label={`${name}: sticker`}>
                {(['MATCHES', 'MISMATCH'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={sticker === value}
                    className={sticker === value ? (value === 'MATCHES' ? 'on ok' : 'on bad') : ''}
                    disabled={change.isPending}
                    onClick={() => {
                      setSticker(value)
                      setError(undefined)
                      change.reset()
                    }}
                  >
                    {value === 'MATCHES' ? 'Matches' : 'Doesn’t match'}
                  </button>
                ))}
              </span>
            </div>
          )}

          {message && <div className="alert alert-bad">{message}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={change.isPending} onClick={press}>
              {change.isPending ? 'Saving…' : 'Save the change'}
            </button>
          </div>
        </div>
      </div>
      {guard.modal}
    </>
  )
}
