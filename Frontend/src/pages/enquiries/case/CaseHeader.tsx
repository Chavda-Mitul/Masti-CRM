import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDate, formatMonthYear, initials } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useResumeCase, useStartDocuments } from '../queries'
import type { VisaCase } from '../types'
import { FileReadyDialog } from './FileReadyDialog'
import { dayMonth } from './labels'
import { MatureDialog } from './MatureDialog'
import { PostponeCancelDialog } from './PostponeCancelDialog'

/** "2 adults, 1 child" */
function travellers(adults: number, children: number) {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return children > 0 ? `${part(adults, 'adult', 'adults')}, ${part(children, 'child', 'children')}` : part(adults, 'adult', 'adults')
}

/** "Documents pending", or why the case is on hold. */
function StatusChip({ visaCase: c }: { visaCase: VisaCase }) {
  if (c.status === 'POSTPONED') {
    return (
      <span className="chip chip-muted">
        Postponed to {formatDate(c.resumeOn)}
        {c.reason && ` · ${c.reason.name}`}
      </span>
    )
  }
  if (c.status === 'CANCELLED') return <span className="chip chip-bad">Cancelled{c.reason && ` · ${c.reason.name}`}</span>
  if (!c.owner && c.maturedAt) return <span className="chip chip-info">Matured · to assign</span>
  // Instead of the step's "Dispatched" ⚠️, which isn't true until Step 4 sends the docket.
  if (c.stage.code === 'DISPATCH' && c.fileReadyAt) return <span className="chip chip-ok">File ready · to dispatch</span>
  return <span className="chip chip-warn">{c.stage.statusLabel}</span>
}

/**
 * The step's own button: "Start collecting documents", "Mark documents complete" (0006 Decision 8), then "File ready —
 * add to docket" (0007 Decision 9). The later steps show as "Soon" until Step 4 onwards is built.
 */
function NextStepButton({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const start = useStartDocuments(c.caseNo)
  const [maturing, setMaturing] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const canAct = me ? canActOnCase(me, { department: c.department.code, owner: c.owner }) : false

  if (c.stage.code === 'ENQUIRY' && canAct) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        disabled={start.isPending}
        onClick={() =>
          start.mutate(undefined, {
            onSuccess: () => toast({ tone: 'ok', message: 'Step 2 started: collecting documents.' }),
            onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t start. Please try again.' }),
          })
        }
      >
        {start.isPending ? 'Starting…' : `${c.stage.nextStepLabel} →`}
      </button>
    )
  }
  if (c.stage.code === 'DOCUMENTS' && c.status === 'OPEN' && canAct) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setMaturing(true)}>
          {c.stage.nextStepLabel} →
        </button>
        {maturing && <MatureDialog visaCase={c} onClose={() => setMaturing(false)} />}
      </>
    )
  }
  if (c.stage.code === 'FILE_PREPARATION' && c.status === 'OPEN' && canAct) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setFinishing(true)}>
          {c.stage.nextStepLabel} →
        </button>
        {finishing && <FileReadyDialog visaCase={c} onClose={() => setFinishing(false)} />}
      </>
    )
  }
  return (
    <button type="button" className="btn btn-primary" disabled title={canAct ? 'Comes with a later step' : 'Only the case’s owner, its HOD and the Head can do this'}>
      {c.stage.nextStepLabel} → {canAct && <span className="tag">Soon</span>}
    </button>
  )
}

/** "Postpone or cancel" on an open case, "Resume" on a postponed one (0006 Decision 6). Owner, HOD or Head. */
function HoldButton({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const resume = useResumeCase(c.caseNo)
  const [open, setOpen] = useState(false)
  const canAct = me ? canActOnCase(me, { department: c.department.code, owner: c.owner }) : false
  if (!canAct) return null

  if (c.status === 'POSTPONED') {
    return (
      <button
        type="button"
        className="btn"
        disabled={resume.isPending}
        onClick={() =>
          resume.mutate(
            { updatedAt: c.updatedAt },
            {
              onSuccess: () => toast({ tone: 'ok', message: 'Case resumed: it is back on the follow-up list.' }),
              onError: (err) => {
                const message = errorText(err)
                if (message) toast({ tone: 'bad', message })
              },
            },
          )
        }
      >
        {resume.isPending ? 'Resuming…' : 'Resume'}
      </button>
    )
  }
  if (c.status !== 'OPEN') return null
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Postpone or cancel
      </button>
      {open && <PostponeCancelDialog visaCase={c} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Title, where the case came from, its status, the actions and the step chips (demo screen 07).
 * The actions show as "Soon" until their part of Step 2 is built (0006).
 */
export function CaseHeader({ visaCase: c }: { visaCase: VisaCase }) {
  const travelling = c.travelDate ? formatDate(c.travelDate) : formatMonthYear(`${c.travelMonth}-01`)

  return (
    <>
      <div className="card pad case-head">
        <span className="avatar avatar-lg" style={{ background: 'var(--dept-tint)', color: 'var(--dept-text)' }}>
          {initials(c.client.name)}
        </span>
        <div className="case-head-text">
          <h1 className="h1">
            {c.country.label} {c.visaType.name.toLowerCase()} visa — {c.client.name}
          </h1>
          <div className="case-head-sub">
            <span className="mono">{c.caseNo}</span> · came in {dayMonth(c.createdAt)} on {c.source.name} ·{' '}
            {travellers(c.adults, c.children)} · travelling {travelling}
          </div>
        </div>
        <div className="case-head-actions">
          <StatusChip visaCase={c} />
          <HoldButton visaCase={c} />
          {c.status === 'OPEN' && c.owner && <NextStepButton visaCase={c} />}
        </div>
      </div>

      <ol className="step-chips" aria-label="Case steps">
        {c.steps.map((s, i) => {
          const step = i + 1
          const state = step < c.stage.step ? 'done' : step === c.stage.step ? 'current' : ''
          return (
            <li key={s.code}>
              <span className={`step-chip ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="step-no">{state === 'done' ? '✓' : step}</span>
                {s.name}
              </span>
            </li>
          )
        })}
      </ol>
    </>
  )
}
