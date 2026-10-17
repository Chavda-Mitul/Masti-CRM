import { useState } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { placeLink } from '../../../lib/place'
import { useToast } from '../../../lib/toast'
import { useCancelFieldJob, useOpenCaseFile } from '../queries'
import type { FieldJob, VisaCase } from '../types'
import { FieldJobDialog } from './FieldJobDialog'
import { bookletsText, dayTime, firstName, weekdayDay } from './labels'

/** How the case talks about each kind of job (0015) ⚠️. */
const WORDING: Record<FieldJob['kind'], { who: string; where: string; book: string; what: string; cancelled: string; done: string }> = {
  PICKUP: { who: 'Collection boy', where: 'Pick up from', book: 'Book the collection boy', what: 'pickup', cancelled: 'Pickup cancelled.', done: 'picked up' },
  DELIVERY: { who: 'Delivery boy', where: 'Deliver to', book: 'Book the delivery boy', what: 'delivery', cancelled: 'Delivery cancelled.', done: 'delivered' },
}

/**
 * The collection or delivery boy on the case (demo Step 2 ⚠️, docs/decisions/0015-field-staff-app.md phases 1–2): once
 * booked, "Collection boy · Ramesh · Tue 6 Oct, 4–6 pm" and "Pick up from · …" (or "Delivery boy" / "Deliver to"), with
 * Change and Cancel (asked inside the page, no browser dialog); otherwise "Book the collection boy" (or delivery boy).
 * Above it, the newest visit he finished (phase 4): what happened, when, and where his phone was.
 * `canBook`: whoever may book this kind on the case.
 */
export function FieldJobLines({ visaCase: c, kind, canBook }: { visaCase: VisaCase; kind: FieldJob['kind']; canBook: boolean }) {
  const toast = useToast()
  const cancel = useCancelFieldJob(c.caseNo)
  const [dialog, setDialog] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const words = WORDING[kind]
  // Newest first: the booked one, if any, and the last he finished.
  const job = c.fieldJobs.find((j) => j.kind === kind && j.status === 'BOOKED')
  const finished = c.fieldJobs.find((j) => j.kind === kind && (j.status === 'DONE' || j.status === 'FAILED'))
  const last = finished && <FinishedLines job={finished} caseNo={c.caseNo} />

  if (!job) {
    return (
      <>
        {last}
        <div className="kv">
          <span>{words.who}</span>
          {canBook ? (
            <button type="button" className="btn btn-sm" onClick={() => setDialog(true)}>
              {words.book}
            </button>
          ) : (
            <span className="muted">Not booked</span>
          )}
          {dialog && <FieldJobDialog visaCase={c} kind={kind} onClose={() => setDialog(false)} />}
        </div>
      </>
    )
  }

  return (
    <>
      {last}
      <div className="kv">
        <span>{words.who}</span>
        <strong>
          {firstName(job.assignee.name)} · {weekdayDay(job.day)}, {job.slot.name}
        </strong>
      </div>
      <div className="kv">
        <span>{words.where}</span>
        <span style={{ textAlign: 'right' }}>
          {job.address}
          {job.mapLink && (
            <>
              {' · '}
              <a href={job.mapLink} target="_blank" rel="noreferrer">
                Map
              </a>
            </>
          )}
        </span>
      </div>
      {canBook && (
        <div className="pickup-actions">
          {confirming ? (
            <>
              <span className="small">
                Call off {firstName(job.assignee.name)}’s {words.what}?
              </span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(
                    { jobId: job.id, updatedAt: c.updatedAt },
                    {
                      onSuccess: () => {
                        setConfirming(false)
                        toast({ tone: 'ok', message: words.cancelled })
                      },
                      onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t cancel. Please try again.' }),
                    },
                  )
                }
              >
                {cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setDialog(true)}>
                Change
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {dialog && <FieldJobDialog visaCase={c} job={job} onClose={() => setDialog(false)} />}
    </>
  )
}

/**
 * The last visit the boy finished (0015 phase 4): "Ramesh couldn't complete · Client not home" (or "Ramesh picked up"),
 * then when, and the place his phone gave, in Google Maps; once done, the booklets he counted, and the proof: the
 * client's code and his selfie, which opens through a short-lived link.
 */
function FinishedLines({ job, caseNo }: { job: FieldJob; caseNo: string }) {
  const words = WORDING[job.kind]
  const who = firstName(job.assignee.name)
  const openFile = useOpenCaseFile(caseNo)
  return (
    <>
      <div className="kv">
        <span>Last visit</span>
        <strong>{job.status === 'DONE' ? `${who} ${words.done}` : `${who} couldn’t complete · ${job.failReason?.name ?? ''}`}</strong>
      </div>
      <div className="kv">
        <span>When</span>
        <span>
          {job.finishedAt && dayTime(job.finishedAt)}
          {job.place && (
            <>
              {' · '}
              <a href={placeLink(job.place)} target="_blank" rel="noreferrer">
                Place
              </a>
            </>
          )}
        </span>
      </div>
      {job.status === 'DONE' && job.counted && (
        <div className="kv">
          <span>Booklets</span>
          <span>{bookletsText(job.counted)}</span>
        </div>
      )}
      {job.status === 'DONE' && (
        <div className="kv">
          <span>Proof</span>
          <span>
            {job.otpConfirmedAt ? 'Code confirmed' : 'No code'}
            {job.selfie && (
              <>
                {' · '}
                <button type="button" className="btn-link" onClick={() => openFile(job.selfie!.id)}>
                  Selfie
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </>
  )
}
