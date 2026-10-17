import { useState } from 'react'
import { canActOnCase, canDispatchDocket, canHandOver } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDate, formatMonthYear, initials } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useResumeCase, useStartDocuments } from '../queries'
import type { VisaCase } from '../types'
import { DecisionDialog } from './DecisionDialog'
import { DispatchDialog } from './DispatchDialog'
import { FileReadyDialog } from './FileReadyDialog'
import { HandoverDialog } from './HandoverDialog'
import { dayMonth, passportsInStock, weekdayDay } from './labels'
import { MatureDialog } from './MatureDialog'
import { PassportsBackDialog } from './PassportsBackDialog'
import { ReceivePassportsDialog } from './ReceivePassportsDialog'
import { PostponeCancelDialog } from './PostponeCancelDialog'
import { SubmissionDialog } from './SubmissionDialog'
import { SubmitOnlineDialog } from './SubmitOnlineDialog'
import { VendorReceivedDialog } from './VendorReceivedDialog'

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
  // Handed back to the client and closed (0014): the step's own "Delivered" ⚠️.
  if (c.status === 'CLOSED') return <span className="chip chip-ok">{c.stage.statusLabel}</span>
  if (!c.owner && c.maturedAt) return <span className="chip chip-info">Matured · to assign</span>
  // Instead of the step's "Dispatched" ⚠️, which isn't true until the docket is sent (0008 Decision 9).
  if (c.stage.code === 'DISPATCH' && c.docket?.status === 'OPEN') return <span className="chip chip-ok">In docket {c.docket.docketNo}</span>
  // An e-visa has no docket: it goes in on the portal (0008 Decision 11). Once in, the step's own "Submitted" ⚠️.
  if (c.stage.code === 'DISPATCH' && c.fileReadyAt && !c.vendorNeeded) return <span className="chip chip-ok">File ready · to submit online</span>
  if (c.stage.code === 'DISPATCH' && c.fileReadyAt) return <span className="chip chip-ok">File ready · to dispatch</span>
  // Taken back from the vendor (0011 Decision 6): the papers come back to Passport back.
  if (c.recall) return <span className="chip chip-warn">Recalled · {c.recall.reason}</span>
  // On the way to the vendor until "Vendor got it" (0011 Decision 2); the step's own "Submitted" comes with the file
  // number, as in the demo ("Submitted · FR-MUM-88421").
  if (c.stage.code === 'AT_VENDOR' && c.submission) return <span className="chip chip-info">{c.stage.statusLabel} · {c.submission.vendorFileNo}</span>
  if (c.stage.code === 'AT_VENDOR' && c.docket?.status === 'DISPATCHED' && c.vendorReceived) return <span className="chip chip-info">With vendor · papers checked</span>
  if (c.stage.code === 'AT_VENDOR' && c.docket?.status === 'DISPATCHED') return <span className="chip chip-info">Dispatched · {c.docket.docketNo}</span>
  // The decision (0012 Decision 6) ⚠️: the step's seeded "Approved" would be wrong for a refusal.
  if (c.stage.code === 'DECISION' && c.decision) {
    const approved = c.travellers.filter((t) => t.decision?.outcome === 'APPROVED').length
    const refused = c.travellers.filter((t) => t.decision?.outcome === 'REFUSED').length
    if (refused === 0) return <span className="chip chip-ok">Approved</span>
    if (approved === 0) return <span className="chip chip-bad">Refused</span>
    return (
      <span className="chip chip-warn">
        Approved {approved} · Refused {refused}
      </span>
    )
  }
  // Received (0013 Decision 5): the step's own "Passports in our stock" ⚠️, as the demo shows it.
  if (c.stage.code === 'PASSPORT_BACK' && c.passportsReceived) return <span className="chip chip-ok">{c.stage.statusLabel}</span>
  // On the way back (0013 Decision 2) ⚠️: the step's "Passports in our stock" isn't true until they're received.
  if (c.stage.code === 'PASSPORT_BACK' && c.passportsBack) return <span className="chip chip-warn">In transit · expected {weekdayDay(c.passportsBack.expectedOn)}</span>
  return <span className="chip chip-warn">{c.stage.statusLabel}</span>
}

/**
 * The step's own button: "Start collecting documents", "Mark documents complete" (0006 Decision 8), "File ready — add
 * to docket" (0007 Decision 9), then "Add to docket", which leads to the Docket card (0008 Decision 2), then "Dispatch
 * docket" (0008 Decision 9). An e-visa has "Submitted online" instead (0008 Decision 11). At the vendor, "Vendor got
 * it" (0011 Decision 2), then "Record the decision" (0012 Decision 6), then "Passports on the way back" (0013 Decision 3), then "Mark received" (0013 Decision 5), then "Hand over to the client" (0014).
 * The later steps show as "Soon" until they are built.
 */
function NextStepButton({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const start = useStartDocuments(c.caseNo)
  const [maturing, setMaturing] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [recording, setRecording] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [sending, setSending] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [handing, setHanding] = useState(false)
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
  if (c.stage.code === 'DISPATCH' && c.status === 'OPEN' && canAct && !c.vendorNeeded && !c.docket) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setSubmitting(true)}>
          Submitted online →
        </button>
        {submitting && <SubmitOnlineDialog visaCase={c} onClose={() => setSubmitting(false)} />}
      </>
    )
  }
  if (c.stage.code === 'DISPATCH' && c.status === 'OPEN' && canAct && c.vendorNeeded && !c.docket) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => document.getElementById('docket')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        Add to docket →
      </button>
    )
  }
  const d = c.docket
  if (c.stage.code === 'DISPATCH' && c.status === 'OPEN' && d?.status === 'OPEN') {
    const allowed = !!me && canDispatchDocket(me, d.cases.map((r) => r.ownerId))
    return (
      <>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allowed}
          title={allowed ? undefined : 'Only the Visa HOD, the Head or a processor with a file in this docket can dispatch it'}
          onClick={() => setDispatching(true)}
        >
          Dispatch docket {d.docketNo} →
        </button>
        {dispatching && <DispatchDialog visaCase={c} onClose={() => setDispatching(false)} />}
      </>
    )
  }
  if (c.stage.code === 'AT_VENDOR' && c.status === 'OPEN' && canAct && d?.status === 'DISPATCHED' && !c.vendorReceived) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
          Vendor got it →
        </button>
        {confirming && <VendorReceivedDialog visaCase={c} onClose={() => setConfirming(false)} />}
      </>
    )
  }
  // After "Vendor got it": the file number, the embassy and the collection date (0011 Decisions 3 and 4).
  if (c.stage.code === 'AT_VENDOR' && c.status === 'OPEN' && canAct && c.vendorReceived && !c.submission) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setRecording(true)}>
          Mark submitted →
        </button>
        {recording && <SubmissionDialog visaCase={c} onClose={() => setRecording(false)} />}
      </>
    )
  }
  // Once the file went in, at the embassy or online: "Record the decision" (0012 Decision 6).
  if (c.stage.code === 'AT_VENDOR' && c.status === 'OPEN' && canAct && (c.submission || c.submittedOnline)) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setDeciding(true)}>
          {c.stage.nextStepLabel} →
        </button>
        {deciding && <DecisionDialog visaCase={c} onClose={() => setDeciding(false)} />}
      </>
    )
  }
  // After a paper visa's decision, or at Passport back for a recalled file: "Passports on the way back" (0013 Decision
  // 3). An e-visa's passports never left the office, so it waits at Decision with no button (Decision 4, M39).
  if (c.stage.code === 'DECISION' && c.submittedOnline) return null
  const returning = c.stage.code === 'DECISION' || (c.stage.code === 'PASSPORT_BACK' && !!c.recall)
  if (returning && !c.passportsBack && c.status === 'OPEN' && canAct) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setSending(true)}>
          {c.stage.code === 'DECISION' ? c.stage.nextStepLabel : 'Passports on the way back'} →
        </button>
        {sending && <PassportsBackDialog visaCase={c} onClose={() => setSending(false)} />}
      </>
    )
  }
  // In our stock: "Hand over to the client" (0014), for whoever is at the desk, not only the case's processor.
  if (me && c.status === 'OPEN' && canHandOver(me, { department: c.department.code, inStock: passportsInStock(c) })) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setHanding(true)}>
          {c.stage.nextStepLabel} →
        </button>
        {handing && <HandoverDialog visaCase={c} onClose={() => setHanding(false)} />}
      </>
    )
  }
  // In transit: "Mark received" (0013 Decision 5). The Passports coming back card has it too, for a case on hold.
  if (c.stage.code === 'PASSPORT_BACK' && c.passportsBack && !c.passportsReceived && c.status === 'OPEN' && canAct) {
    return (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setReceiving(true)}>
          Mark received →
        </button>
        {receiving && <ReceivePassportsDialog visaCase={c} onClose={() => setReceiving(false)} />}
      </>
    )
  }
  const label = c.stage.nextStepLabel
  return (
    <button type="button" className="btn btn-primary" disabled title={canAct ? 'Comes with a later step' : 'Only the case’s owner, its HOD and the Head can do this'}>
      {label} → {canAct && <span className="tag">Soon</span>}
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
          // A recalled file never reached a decision (0011 Decision 6): that step was skipped, not done.
          const skipped = !!c.recall && s.code === 'DECISION'
          const state = skipped ? 'skipped' : step < c.stage.step ? 'done' : step === c.stage.step ? 'current' : ''
          return (
            <li key={s.code}>
              <span className={`step-chip ${state}`} aria-current={state === 'current' ? 'step' : undefined} title={skipped ? 'Skipped: the file was taken back' : undefined}>
                <span className="step-no">{state === 'done' ? '✓' : skipped ? '–' : step}</span>
                {s.name}
              </span>
            </li>
          )
        })}
      </ol>
    </>
  )
}
