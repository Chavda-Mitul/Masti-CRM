import { useState, type ReactNode } from 'react'
import { issueText } from '../../lib/apiErrors'
import { digits, timeOf, type TypedBooklets } from './labels'
import { useCheckOtp, useSendOtp } from './queries'
import type { OtpState } from './types'

// The steps at the client's door (docs/decisions/0015-field-staff-app.md Decision 4; demo screen 14), shared by the
// pickup (PickupSteps) and the delivery (DeliverySteps).

/** One of the demo's numbered steps: a green tick once it's done. */
export function Step({ n, done, title, hint, children }: { n: number; done: boolean; title: string; hint: string; children?: ReactNode }) {
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

/** "Booklets counted": current and old, typed into two boxes. `problem`: a count that doesn't match, said under them. */
export function BookletsStep({
  n,
  value,
  onChange,
  done,
  hint,
  problem,
  disabled,
}: {
  n: number
  value: TypedBooklets
  onChange: (value: TypedBooklets) => void
  done: boolean
  hint: string
  problem?: string | null
  disabled: boolean
}) {
  return (
    <Step n={n} done={done} title="Booklets counted" hint={hint}>
      <div className="field-count-row">
        <label className="field-count">
          Current
          <input className="input" inputMode="numeric" value={value.current} onChange={(e) => onChange({ ...value, current: digits(e.target.value, 2) })} disabled={disabled} />
        </label>
        <label className="field-count">
          Old
          <input className="input" inputMode="numeric" value={value.old} onChange={(e) => onChange({ ...value, old: digits(e.target.value, 2) })} disabled={disabled} />
        </label>
      </div>
      {problem && <span className="field-step-error">{problem}</span>}
    </Step>
  )
}

/**
 * "Code from the client" (Decision 4): Send the code to the client's email, then the 6 digits they read out and Check,
 * or Send a new code; once confirmed, when. No code, no pickup or handover: without it he uses Couldn't complete.
 */
export function CodeStep({ n, jobId, otp, disabled }: { n: number; jobId: string; otp: OtpState | null; disabled: boolean }) {
  const [code, setCode] = useState('')
  const sendOtp = useSendOtp(jobId)
  const checkOtp = useCheckOtp(jobId)
  const busy = disabled || sendOtp.isPending || checkOtp.isPending
  const confirmedAt = otp?.confirmedAt ?? null
  const problem = issueText(checkOtp.error ?? sendOtp.error)
  const send = () => {
    checkOtp.reset()
    sendOtp.mutate()
  }

  return (
    <Step
      n={n}
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
              <button type="button" className="btn btn-dark" disabled={busy || code.length !== 6} onClick={() => checkOtp.mutate(code, { onSuccess: () => setCode('') })}>
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
      {problem && <span className="field-step-error">{problem}</span>}
    </Step>
  )
}
