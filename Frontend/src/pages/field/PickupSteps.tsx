import { useState } from 'react'
import { useNavigate } from 'react-router'
import { issueText } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { BookletsStep, CodeStep, Step } from './DoorSteps'
import { countOf, type TypedBooklets } from './labels'
import { PhotoStep, type TakenPhoto } from './PhotoStep'
import { useMarkDone } from './queries'
import type { OtpState } from './types'

/**
 * At a pickup (docs/decisions/0015-field-staff-app.md Decision 4; demo screen 14's steps): the booklets he counts, the
 * client's one-time code (sent to their email; they read it out), and his selfie at the door with the place and time.
 * "Finish pickup" waits for all three, then records it and takes him back to his run. No code, no pickup: without it
 * he uses Couldn't complete (decided 17 Oct 2026).
 */
export function PickupSteps({ jobId, otp }: { jobId: string; otp: OtpState | null }) {
  const [booklets, setBooklets] = useState<TypedBooklets>({ current: '', old: '' })
  const [selfie, setSelfie] = useState<TakenPhoto | null>(null)
  const markDone = useMarkDone(jobId)
  const toast = useToast()
  const navigate = useNavigate()

  const counted = countOf(booklets)
  const confirmed = !!otp?.confirmedAt
  const left = [counted !== null, confirmed, selfie !== null].filter((done) => !done).length

  const finish = () => {
    if (!counted || !selfie?.place || !confirmed) return
    markDone.mutate(
      { booklets: counted, selfieId: selfie.id, place: selfie.place },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: 'Pickup recorded.' })
          navigate('/tasks')
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
        done={counted !== null}
        hint={counted ? `${counted.current} current + ${counted.old} old` : 'Count the passports the client gives you (0 if none).'}
        disabled={markDone.isPending}
      />
      <CodeStep n={2} jobId={jobId} otp={otp} disabled={markDone.isPending} />
      <Step n={3} done={selfie !== null} title="Your selfie at the door" hint="Place and time are added by the phone.">
        <PhotoStep jobId={jobId} kind="selfie" value={selfie} onChange={setSelfie} disabled={markDone.isPending} />
      </Step>

      {markDone.error && <div className="alert alert-bad">{issueText(markDone.error)}</div>}
      <button type="button" className="btn btn-primary field-finish" onClick={finish} disabled={left > 0 || markDone.isPending}>
        {markDone.isPending ? 'Saving…' : left > 0 ? `Finish pickup · ${left} ${left === 1 ? 'step' : 'steps'} left` : 'Finish pickup'}
      </button>
    </section>
  )
}
