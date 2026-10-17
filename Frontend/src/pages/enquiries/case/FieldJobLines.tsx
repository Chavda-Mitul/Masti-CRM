import { useState } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useCancelFieldJob } from '../queries'
import type { FieldJob, VisaCase } from '../types'
import { FieldJobDialog } from './FieldJobDialog'
import { firstName, weekdayDay } from './labels'

/** How the case talks about each kind of job (0015) ⚠️. */
const WORDING: Record<FieldJob['kind'], { who: string; where: string; book: string; what: string; cancelled: string }> = {
  PICKUP: { who: 'Collection boy', where: 'Pick up from', book: 'Book the collection boy', what: 'pickup', cancelled: 'Pickup cancelled.' },
  DELIVERY: { who: 'Delivery boy', where: 'Deliver to', book: 'Book the delivery boy', what: 'delivery', cancelled: 'Delivery cancelled.' },
}

/**
 * The collection or delivery boy on the case (demo Step 2 ⚠️, docs/decisions/0015-field-staff-app.md phases 1–2): once
 * booked, "Collection boy · Ramesh · Tue 6 Oct, 4–6 pm" and "Pick up from · …" (or "Delivery boy" / "Deliver to"), with
 * Change and Cancel (asked inside the page, no browser dialog); otherwise "Book the collection boy" (or delivery boy).
 * `canBook`: whoever may book this kind on the case.
 */
export function FieldJobLines({ visaCase: c, kind, canBook }: { visaCase: VisaCase; kind: FieldJob['kind']; canBook: boolean }) {
  const toast = useToast()
  const cancel = useCancelFieldJob(c.caseNo)
  const [dialog, setDialog] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const words = WORDING[kind]
  // Newest first: the booked one, if any.
  const job = c.fieldJobs.find((j) => j.kind === kind && j.status === 'BOOKED')

  if (!job) {
    return (
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
    )
  }

  return (
    <>
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
