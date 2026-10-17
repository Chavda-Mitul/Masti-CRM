import { useState } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useCancelFieldJob } from '../queries'
import type { VisaCase } from '../types'
import { FieldJobDialog } from './FieldJobDialog'
import { firstName, weekdayDay } from './labels'

/**
 * The collection boy on "How the documents reach us" (demo Step 2 ⚠️, docs/decisions/0015-field-staff-app.md phase 1):
 * "Collection boy · Ramesh · Tue 6 Oct, 4–6 pm" and "Pick up from · …" once booked, with Change and Cancel (asked
 * inside the page, no browser dialog); "Book the collection boy" otherwise. `canBook`: whoever can act on the case at
 * Steps 1–2.
 */
export function PickupJob({ visaCase: c, canBook }: { visaCase: VisaCase; canBook: boolean }) {
  const toast = useToast()
  const cancel = useCancelFieldJob(c.caseNo)
  const [dialog, setDialog] = useState<'book' | 'change' | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Newest first: the booked one, if any.
  const job = c.fieldJobs.find((j) => j.kind === 'PICKUP' && j.status === 'BOOKED')

  if (!job) {
    return (
      <div className="kv">
        <span>Collection boy</span>
        {canBook ? (
          <button type="button" className="btn btn-sm" onClick={() => setDialog('book')}>
            Book the collection boy
          </button>
        ) : (
          <span className="muted">Not booked</span>
        )}
        {dialog && <FieldJobDialog visaCase={c} onClose={() => setDialog(null)} />}
      </div>
    )
  }

  return (
    <>
      <div className="kv">
        <span>Collection boy</span>
        <strong>
          {firstName(job.assignee.name)} · {weekdayDay(job.day)}, {job.slot.name}
        </strong>
      </div>
      <div className="kv">
        <span>Pick up from</span>
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
              <span className="small">Call off {firstName(job.assignee.name)}’s pickup?</span>
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
                        toast({ tone: 'ok', message: 'Pickup cancelled.' })
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
              <button type="button" className="btn btn-sm" onClick={() => setDialog('change')}>
                Change
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {dialog && <FieldJobDialog visaCase={c} job={job} onClose={() => setDialog(null)} />}
    </>
  )
}
