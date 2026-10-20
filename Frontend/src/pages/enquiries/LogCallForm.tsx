import { useState } from 'react'
import { RequiredMark } from '../../components/FormField'
import { errorBody, errorText } from '../../lib/apiErrors'
import { istToday } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { useMasterList } from '../settings/masters/queries'
import { useLogFollowUp } from './queries'

/**
 * "Log call" (0006 Decision 6, demo screen 21): What happened → Next step → When. Both lists are masters, so there is
 * no free text, and list only the values tagged with the case's department (0018). "When" starts empty (decided 10 Oct 2026); the server refuses a past time or a day the office is closed.
 * Logging a call on a postponed case resumes it.
 */
export function LogCallForm({
  caseNo,
  departmentCode,
  updatedAt,
  postponed,
  onDone,
  onCancel,
}: {
  caseNo: string
  departmentCode: string
  updatedAt: string
  postponed: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const toast = useToast()
  const outcomes = useMasterList('follow-up-outcomes')
  const nextSteps = useMasterList('follow-up-next-steps')
  const log = useLogFollowUp(caseNo)
  const [outcomeId, setOutcomeId] = useState('')
  const [nextStepId, setNextStepId] = useState('')
  const [nextOn, setNextOn] = useState('')
  const [at, setAt] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const missing: Record<string, string> = {}
    if (!outcomeId) missing.outcomeId = 'Pick what happened.'
    if (!nextStepId) missing.nextStepId = 'Pick the next step.'
    if (!nextOn) missing.nextOn = 'Pick the day.'
    if (!at) missing.at = 'Pick the time.'
    setErrors(missing)
    if (Object.keys(missing).length) return

    log.mutate(
      { outcomeId: Number(outcomeId), nextStepId: Number(nextStepId), nextOn, at, updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: postponed ? 'Call logged. The case is open again.' : 'Call logged.' })
          onDone()
        },
        // The backend's per-field messages (400 issues), next to the matching inputs.
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
        },
      },
    )
  }

  const message = errorText(log.error)
  const busy = outcomes.isPending || nextSteps.isPending

  return (
    <div className="log-call">
      <div className="log-call-grid">
        <label className="field">
          <span className="lbl">What happened<RequiredMark /></span>
          <select className="select" value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} disabled={busy} autoFocus>
            <option value="">{busy ? 'Loading…' : 'Pick…'}</option>
            {(outcomes.data ?? [])
              .filter((o) => o.isActive && o.departments.includes(departmentCode))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
          {errors.outcomeId && <span className="field-error">{errors.outcomeId}</span>}
        </label>

        <label className="field">
          <span className="lbl">Next step<RequiredMark /></span>
          <select className="select" value={nextStepId} onChange={(e) => setNextStepId(e.target.value)} disabled={busy}>
            <option value="">{busy ? 'Loading…' : 'Pick…'}</option>
            {(nextSteps.data ?? [])
              .filter((o) => o.isActive && o.departments.includes(departmentCode))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
          {errors.nextStepId && <span className="field-error">{errors.nextStepId}</span>}
        </label>

        <div className="field">
          <span className="lbl">When<RequiredMark /></span>
          <div className="log-call-when">
            <input
              className="input"
              type="date"
              min={istToday()}
              value={nextOn}
              onChange={(e) => setNextOn(e.target.value)}
              aria-label="Next follow-up day"
            />
            <input className="input" type="time" step={900} value={at} onChange={(e) => setAt(e.target.value)} aria-label="Next follow-up time" />
          </div>
          {(errors.nextOn || errors.at) && <span className="field-error">{errors.nextOn ?? errors.at}</span>}
        </div>

        <div className="log-call-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={log.isPending}>
            {log.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {postponed && <p className="muted small log-call-note">This case is postponed. Saving the call opens it again.</p>}
      {message && <div className="alert alert-bad">{message}</div>}
    </div>
  )
}
