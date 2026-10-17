import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { issueText } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { timeOf } from './labels'
import { useCheckOtp, useMarkDone, useSendOtp } from './queries'
import { SelfieStep, type Selfie } from './SelfieStep'
import type { OtpState } from './types'

/** A booklet count as typed: a whole number up to 50, else null. */
const countOf = (typed: string) => (/^\d{1,2}$/.test(typed) && Number(typed) <= 50 ? Number(typed) : null)

/** One of the demo's numbered steps: a green tick once it's done. */
function Step({ n, done, title, hint, children }: { n: number; done: boolean; title: string; hint: string; children?: ReactNode }) {
  return (
    <div className={`field-step${done ? ' is-done' : ''}`}>
      <span className="field-step-mark" aria-hidden>
        {done ? '✓' : n}
      </span>
      <div className="field-step-body">
        <span className="field-step-title">{title}</span>
        <span className="field-step-hint">{hint}</span>
        {children}
      </div>
    </div>
  )
}

/**
 * At a pickup (docs/decisions/0015-field-staff-app.md Decision 4; demo screen 14's steps): the booklets he counts, the
 * client's one-time code (sent to their email; they read it out), and his selfie at the door with the place and time.
 * "Finish pickup" waits for all three, then records it and takes him back to his run. No code, no pickup: without it
 * he uses Couldn't complete (decided 17 Oct 2026).
 */
export function PickupSteps({ jobId, otp }: { jobId: string; otp: OtpState | null }) {
  const [current, setCurrent] = useState('')
  const [old, setOld] = useState('')
  const [code, setCode] = useState('')
  const [selfie, setSelfie] = useState<Selfie | null>(null)
  const sendOtp = useSendOtp(jobId)
  const checkOtp = useCheckOtp(jobId)
  const markDone = useMarkDone(jobId)
  const toast = useToast()
  const navigate = useNavigate()

  const counted = countOf(current) !== null && countOf(old) !== null ? { current: countOf(current)!, old: countOf(old)! } : null
  const confirmedAt = otp?.confirmedAt ?? null
  const left = [counted !== null, confirmedAt !== null, selfie !== null].filter((done) => !done).length
  const busy = sendOtp.isPending || checkOtp.isPending || markDone.isPending
  const codeProblem = issueText(checkOtp.error ?? sendOtp.error)

  const send = () => {
    checkOtp.reset()
    sendOtp.mutate()
  }
  const finish = () => {
    if (!counted || !selfie || !confirmedAt) return
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
  const digits = (typed: string, max: number) => typed.replace(/\D/g, '').slice(0, max)

  return (
    <section className="card field-steps" aria-label="At the door">
      <Step
        n={1}
        done={counted !== null}
        title="Booklets counted"
        hint={counted ? `${counted.current} current + ${counted.old} old` : 'Count the passports the client gives you (0 if none).'}
      >
        <div className="field-count-row">
          <label className="field-count">
            Current
            <input className="input" inputMode="numeric" value={current} onChange={(e) => setCurrent(digits(e.target.value, 2))} disabled={markDone.isPending} />
          </label>
          <label className="field-count">
            Old
            <input className="input" inputMode="numeric" value={old} onChange={(e) => setOld(digits(e.target.value, 2))} disabled={markDone.isPending} />
          </label>
        </div>
      </Step>

      <Step
        n={2}
        done={confirmedAt !== null}
        title="Code from the client"
        hint={
          confirmedAt
            ? `Confirmed by the client at ${timeOf(confirmedAt)}`
            : otp
              ? `Sent to ${otp.sentTo} at ${timeOf(otp.sentAt)}. Ask the client to read it out.`
              : 'It goes to the client’s email; they read it out to you.'
        }
      >
        {confirmedAt === null &&
          (otp ? (
            <>
              <div className="field-code-row">
                <input
                  className="input field-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6 digits"
                  aria-label="The code"
                  value={code}
                  onChange={(e) => setCode(digits(e.target.value, 6))}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="btn btn-dark"
                  disabled={busy || code.length !== 6}
                  onClick={() => checkOtp.mutate(code, { onSuccess: () => setCode('') })}
                >
                  {checkOtp.isPending ? 'Checking…' : 'Check'}
                </button>
              </div>
              <button type="button" className="btn-link field-resend" onClick={send} disabled={busy}>
                {sendOtp.isPending ? 'Sending…' : 'Send a new code'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary field-step-action" onClick={send} disabled={busy}>
              {sendOtp.isPending ? 'Sending…' : 'Send the code'}
            </button>
          ))}
        {codeProblem && <span className="field-step-error">{codeProblem}</span>}
      </Step>

      <Step n={3} done={selfie !== null} title="Your selfie at the door" hint="Place and time are added by the phone.">
        <SelfieStep jobId={jobId} value={selfie} onChange={setSelfie} disabled={markDone.isPending} />
      </Step>

      {markDone.error && <div className="alert alert-bad">{issueText(markDone.error)}</div>}
      <button type="button" className="btn btn-primary field-finish" onClick={finish} disabled={left > 0 || markDone.isPending}>
        {markDone.isPending ? 'Saving…' : left > 0 ? `Finish pickup · ${left} ${left === 1 ? 'step' : 'steps'} left` : 'Finish pickup'}
      </button>
    </section>
  )
}
