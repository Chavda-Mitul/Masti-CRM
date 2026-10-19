import { useState } from 'react'
import { useNavigate } from 'react-router'
import { issueText } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { useWarningGuard } from '../../lib/useWarningGuard'
import { BookletsStep, CodeStep, Step } from './DoorSteps'
import { countOf, handOverText, type TypedBooklets } from './labels'
import { PhotoStep, type TakenPhoto } from './PhotoStep'
import { useHandOverAtDoor } from './queries'
import type { OtpState, RunStop } from './types'

/** "Someone else": a person not on the case, by name. */
const OTHER = 'other'

/**
 * The handover at the client's door (docs/decisions/0015-field-staff-app.md Decision 4, phase 5; demo screen 14): the
 * booklets he counts, which must match our stock; the client's one-time code; who receives them (a traveller on the
 * case, or someone else by name) and a photo of that person; and his selfie with the place and time. "Finish handover"
 * waits for all four. No code, or a count that doesn't match: no handover; he brings the passports back and uses
 * Couldn't complete (decided 17 Oct 2026).
 */
export function DeliverySteps({ stop, otp }: { stop: RunStop; otp: OtpState | null }) {
  const [booklets, setBooklets] = useState<TypedBooklets>({ current: '', old: '' })
  const [pick, setPick] = useState<string | null>(null)
  const [otherName, setOtherName] = useState('')
  const [photo, setPhoto] = useState<TakenPhoto | null>(null)
  const [selfie, setSelfie] = useState<TakenPhoto | null>(null)
  const handOver = useHandOverAtDoor(stop.id)
  // A child picked as who receives them: check, then hand over anyway.
  const guard = useWarningGuard()
  const toast = useToast()
  const navigate = useNavigate()
  const busy = handOver.isPending

  const stock = stop.booklets
  const counted = countOf(booklets)
  const matches = counted !== null && stock !== null && counted.current === stock.current && counted.old === stock.old
  const mismatch =
    counted && stock && !matches
      ? `Count again: our stock has ${stock.current} current + ${stock.old} old. If one is missing, don't hand over: use Couldn't complete.`
      : null
  const receiver = pick === null ? null : pick === OTHER ? (otherName.trim().length >= 2 ? { name: otherName.trim() } : null) : { travellerId: pick }
  const confirmed = !!otp?.confirmedAt
  const left = [matches, confirmed, receiver !== null && photo !== null, selfie !== null].filter((done) => !done).length

  const finish = (confirmWarnings = false): void => {
    if (!counted || !matches || !confirmed || !receiver || !photo || !selfie?.place) return
    handOver.mutate(
      { booklets: counted, receiver, photoId: photo.id, selfieId: selfie.id, place: selfie.place, ...(confirmWarnings ? { confirmWarnings } : {}) },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: 'Passports handed over.' })
          navigate('/tasks')
        },
        onError: (err) => {
          guard.intercept(err, () => finish(true))
        },
      },
    )
  }

  return (
    <section className="card field-steps" aria-label="At the door">
      <BookletsStep
        n={1}
        value={booklets}
        onChange={setBooklets}
        done={matches}
        hint={stock ? `Our stock: ${handOverText(stock)}. Count what you hand over.` : 'Count the passports you hand over.'}
        problem={mismatch}
        disabled={busy}
      />
      <CodeStep n={2} jobId={stop.id} otp={otp} disabled={busy} />
      <Step
        n={3}
        done={receiver !== null && photo !== null}
        title="Photo of the person receiving"
        hint={receiver && 'name' in receiver ? `${receiver.name} receives them.` : 'Who takes the passports? Then their photo.'}
      >
        <div className="field-reasons" role="radiogroup" aria-label="Who receives">
          {stop.travellers.map((t) => (
            <label key={t.id} className={`field-reason${pick === t.id ? ' is-picked' : ''}`}>
              <input type="radio" name="receiver" checked={pick === t.id} onChange={() => setPick(t.id)} disabled={busy} />
              {t.name}
              {t.isChild && <span className="muted"> · child</span>}
            </label>
          ))}
          <label className={`field-reason${pick === OTHER ? ' is-picked' : ''}`}>
            <input type="radio" name="receiver" checked={pick === OTHER} onChange={() => setPick(OTHER)} disabled={busy} />
            Someone else
          </label>
          {pick === OTHER && (
            <input
              className="input field-other-name"
              placeholder="Their name"
              aria-label="The name of the person receiving"
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              maxLength={100}
              disabled={busy}
            />
          )}
        </div>
        <PhotoStep jobId={stop.id} kind="receiver" value={photo} onChange={setPhoto} disabled={busy} />
      </Step>
      <Step n={4} done={selfie !== null} title="Your selfie at the door" hint="Place and time are added by the phone.">
        <PhotoStep jobId={stop.id} kind="selfie" value={selfie} onChange={setSelfie} disabled={busy} />
      </Step>

      {/* A warning shows as "Check before saving", not here. */}
      {issueText(handOver.error) && <div className="alert alert-bad">{issueText(handOver.error)}</div>}
      {guard.modal}
      <button type="button" className="btn btn-primary field-finish" onClick={() => finish()} disabled={left > 0 || busy}>
        {busy ? 'Saving…' : left > 0 ? `Finish handover · ${left} ${left === 1 ? 'step' : 'steps'} left` : 'Finish handover'}
      </button>
    </section>
  )
}
