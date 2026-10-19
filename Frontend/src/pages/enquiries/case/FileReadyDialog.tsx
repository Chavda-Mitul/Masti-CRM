import { useQueryClient } from '@tanstack/react-query'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { enquiryKeys, useMarkFileReady } from '../queries'
import type { FileReadyMissing, TripField, VisaCase } from '../types'

const TRIP_WORDS: Record<TripField, string> = { departOn: 'travelling out', returnOn: 'coming back', entryType: 'entry' }

/** What the loaded case still lacks: the same rule the backend checks (0007 Decision 9). */
function missingOf(c: VisaCase): FileReadyMissing {
  const name = (t: VisaCase['travellers'][number]) => t.member?.name ?? t.label
  return {
    papers: c.travellers
      .map((t) => {
        const papers = t.documents.filter((d) => d.status === 'RECEIVED' || d.status === 'MADE')
        return {
          traveller: name(t),
          toCheck: papers.filter((d) => d.check === null).map((d) => d.name),
          needsReplacing: papers.filter((d) => d.check === 'NEEDS_REPLACING').map((d) => d.name),
        }
      })
      .filter((p) => p.toCheck.length > 0 || p.needsReplacing.length > 0),
    ackNo: c.travellers.filter((t) => !t.ackNo).map(name),
    appointment: c.appointmentNeeded ? c.travellers.filter((t) => !t.appointmentAt).map(name) : [],
    finalFile: !c.finalFile,
    vendor: !c.vendorNeeded ? null : !c.vendor ? 'NONE' : !c.vendor.isActive ? 'SWITCHED_OFF' : c.vendor.coversCountry ? null : 'NOT_COVERING',
    trip: (['departOn', 'returnOn', 'entryType'] as const).filter((field) => c.trip[field] === null),
  }
}

const isEmpty = (m: FileReadyMissing) =>
  m.papers.length === 0 && m.ackNo.length === 0 && m.appointment.length === 0 && !m.finalFile && m.vendor === null && m.trip.length === 0

/**
 * "File ready — add to docket" (0007 Decision 9). Lists what Step 3 still lacks before anything is sent; once everything
 * is in, the case moves to Docket & dispatch and stays with its processor. Step 3 is read-only after that.
 */
export function FileReadyDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const { data: me } = useMe()
  const toast = useToast()
  const queryClient = useQueryClient()
  const markReady = useMarkFileReady(c.caseNo)
  // A passport that runs out too soon after the trip: check, then send it anyway.
  const guard = useWarningGuard()

  // The server's list wins when it disagrees (someone changed a check meanwhile).
  const serverMissing =
    errorCode(markReady.error) === 'NOT_READY' ? (errorBody(markReady.error)?.details?.missing as FileReadyMissing | undefined) : undefined
  const missing = serverMissing ?? missingOf(c)
  const ready = isEmpty(missing)
  const message = serverMissing ? null : errorText(markReady.error)
  const staysWith = c.owner?.id === me?.id ? 'you' : (c.owner?.name ?? 'the processor')

  const submit = (confirmWarnings = false): void =>
    markReady.mutate(
      { updatedAt: c.updatedAt, ...(confirmWarnings ? { confirmWarnings } : {}) },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: 'File ready. The case is in Docket & dispatch.' })
          onClose()
        },
        // Someone changed Step 3 meanwhile: reload the case so the cards behind the dialog show what its list says.
        onError: (err) => {
          if (guard.intercept(err, () => submit(true))) return
          if (errorCode(err) === 'NOT_READY') void queryClient.invalidateQueries({ queryKey: enquiryKeys.case(c.caseNo) })
        },
      },
    )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog file-ready-dialog" role="dialog" aria-modal="true" aria-labelledby="file-ready-title" onClick={(e) => e.stopPropagation()}>
        {guard.modal}
        <h2 className="h2" id="file-ready-title">
          File ready — add to docket
        </h2>

        {ready ? (
          <p style={{ margin: 0 }}>
            Everything is checked. The case moves to Docket &amp; dispatch and stays with {staysWith}. Step 3 can’t be changed
            after this.
          </p>
        ) : (
          <div className="alert alert-warn">
            <strong>Not ready yet.</strong>
            <ul className="missing-list">
              {missing.papers.flatMap((p) => [
                ...(p.toCheck.length > 0
                  ? [
                      <li key={`check-${p.traveller}`}>
                        <strong>{p.traveller}:</strong> {p.toCheck.join(', ')} still to check
                      </li>,
                    ]
                  : []),
                ...(p.needsReplacing.length > 0
                  ? [
                      <li key={`replace-${p.traveller}`}>
                        <strong>{p.traveller}:</strong> {p.needsReplacing.join(', ')} needs replacing
                      </li>,
                    ]
                  : []),
              ])}
              {missing.ackNo.length > 0 && <li>Acknowledgement no. for {missing.ackNo.join(', ')}</li>}
              {missing.appointment.length > 0 && <li>Appointment for {missing.appointment.join(', ')}</li>}
              {missing.finalFile && <li>The saved file (PDF)</li>}
              {missing.vendor === 'NONE' && <li>A vendor</li>}
              {missing.vendor === 'SWITCHED_OFF' && <li>An active vendor ({c.vendor ? `${c.vendor.name} is` : 'the one picked is'} switched off)</li>}
              {missing.vendor === 'NOT_COVERING' && (
                <li>
                  A vendor that covers {c.country.name} ({c.vendor ? c.vendor.name : 'the one picked'} no longer does)
                </li>
              )}
              {missing.trip.length > 0 && <li>Trip details: {missing.trip.map((field) => TRIP_WORDS[field]).join(', ')}</li>}
            </ul>
          </div>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || markReady.isPending} onClick={() => submit()}>
            {markReady.isPending ? 'Saving…' : 'Mark file ready'}
          </button>
        </div>
      </div>
    </div>
  )
}
