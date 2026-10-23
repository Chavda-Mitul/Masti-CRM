import { useState } from 'react'
import { Link } from 'react-router'
import { canActOnCase, isHodOf } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { RequiredMark } from '../../../components/FormField'
import { errorBody, errorText, issueText, lostAccess } from '../../../lib/apiErrors'
import { formatMobile, initials } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { NORMAL_URGENCY } from '../../settings/masters/schemas'
import { useAssignees, useReassignCase, useSetUrgency } from '../queries'
import type { VisaCase } from '../types'
import { isFollowUpStep, windingDown } from './labels'
import { MessagesSection } from './MessagesSection'
import { MoneySection } from './MoneySection'

/**
 * The right rail (demo screen 07): who the case is for, whose job it is now, how urgent it is (0003 amendment 1), what
 * the CRM has sent the client (0021), and the money on the case (the quote, 0009). The HOD or the Head can give the case
 * to someone else (0006 Decision 6).
 */
export function CaseRail({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [reassigning, setReassigning] = useState(false)
  // A cancelled case too while its passports are still to hand back (docs/decisions/0002-user-types.md amendment 1).
  const canReassign = !!me && isHodOf(me, c.department.code) && (c.status === 'OPEN' || c.status === 'POSTPONED' || windingDown(c))

  return (
    <aside className="card pad">
      <div className="rail-section">
        <div className="lbl">Who it is for</div>
        <div className="rail-person">
          <span className="avatar">{initials(c.client.name)}</span>
          <div>
            <Link to={`/clients/${c.client.id}`}>
              <strong>{c.client.name}</strong>
            </Link>
            <span className="mono small">{formatMobile(c.client.mobile)}</span>
          </div>
        </div>
      </div>

      <div className="rail-section">
        <div className="lbl">Whose job it is now</div>
        {c.owner ? (
          <div className="rail-person">
            <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--on-fill)' }}>
              {initials(c.owner.name)}
            </span>
            <div>
              <strong>{c.owner.name}</strong>
              <span className="muted small">{isFollowUpStep(c) ? 'Follow-up' : 'Processing'}</span>
            </div>
          </div>
        ) : (
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {isFollowUpStep(c) ? 'Waiting for the HOD to give it to someone.' : 'Waiting for the HOD to pick a processor.'}
          </p>
        )}
        {canReassign && (
          <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setReassigning(true)}>
            {c.owner ? 'Reassign' : isFollowUpStep(c) ? 'Assign' : 'Assign processor'}
          </button>
        )}
      </div>

      <UrgencySection visaCase={c} />
      <MessagesSection visaCase={c} />
      <MoneySection visaCase={c} />
      {reassigning && <ReassignDialog visaCase={c} onClose={() => setReassigning(false)} />}
    </aside>
  )
}

/**
 * How urgent the case is (0003 amendment 1): its owner, the Visa HOD or the Head switch it while the case is open, at
 * any step, like the Reminders switch; everyone else sees it. Every level but Normal is red. A level switched off since
 * stays on this case, but isn't offered to the others.
 */
function UrgencySection({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const levels = useMasterList('urgency-levels')
  const set = useSetUrgency(c.caseNo)
  const canChange = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner }) && c.status === 'OPEN'
  const choices = (levels.data ?? []).filter((l) => l.isActive || l.id === c.urgency.id)
  const urgent = (code: string) => code !== NORMAL_URGENCY

  const change = (id: number, name: string) => {
    if (id === c.urgency.id) return
    set.mutate(
      { urgencyId: id },
      {
        onSuccess: () => toast({ tone: 'ok', message: `Marked ${name}.` }),
        onError: (err) => {
          const message = issueText(err)
          if (message) toast({ tone: 'bad', message })
        },
      },
    )
  }

  return (
    <div className="rail-section">
      <div className="lbl">How urgent</div>
      {canChange && choices.length > 0 ? (
        <div className="seg-btn" role="radiogroup" aria-label="How urgent" style={{ marginTop: 8 }}>
          {choices.map((l) => {
            const on = l.id === c.urgency.id
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? (urgent(l.code) ? 'on bad' : 'on') : ''}
                disabled={set.isPending}
                onClick={() => change(l.id, l.name)}
              >
                {l.name}
              </button>
            )
          })}
        </div>
      ) : (
        <p style={{ margin: '8px 0 0' }}>{urgent(c.urgency.code) ? <span className="chip chip-bad chip-sm">{c.urgency.name}</span> : c.urgency.name}</p>
      )}
    </div>
  )
}

function ReassignDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const assignees = useAssignees(c.caseNo, true)
  const reassign = useReassignCase(c.caseNo)
  const [ownerId, setOwnerId] = useState('')
  const fieldError = errorBody(reassign.error)?.issues?.ownerId?.[0]
  const message = fieldError ? null : errorText(reassign.error)
  const choices = (assignees.data ?? []).filter((a) => !a.isOwner)

  const save = () =>
    reassign.mutate(
      { ownerId, updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `Case given to ${choices.find((a) => a.id === ownerId)?.name ?? 'them'}.` })
          onClose()
        },
      },
    )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="reassign-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="reassign-title">
          {c.owner ? `Give ${c.caseNo} to someone else` : isFollowUpStep(c) ? `Give ${c.caseNo} to someone` : `Pick a processor for ${c.caseNo}`}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {c.owner ? `It is with ${c.owner.name} now. ` : ''}They will see it in their list and do its follow-ups.
        </p>
        <label className="field">
          <span className="lbl">Give it to<RequiredMark /></span>
          <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={assignees.isPending}>
            <option value="">{assignees.isPending ? 'Loading…' : 'Pick a person…'}</option>
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {fieldError && <span className="field-error">{fieldError}</span>}
        </label>
        {(assignees.isLoadingError || lostAccess(assignees)) && <div className="alert alert-bad">{errorText(assignees.error)}</div>}
        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={!ownerId || reassign.isPending} onClick={save}>
            {reassign.isPending ? 'Saving…' : 'Give the case'}
          </button>
        </div>
      </div>
    </div>
  )
}
