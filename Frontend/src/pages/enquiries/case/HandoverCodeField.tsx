import { useState } from 'react'
import { RequiredMark } from '../../../components/FormField'
import { issueText } from '../../../lib/apiErrors'
import { digitsOnly } from '../../../lib/inputFilters'
import { useCheckHandoverCode, useHandoverCode, useSendHandoverCode } from '../queries'
import { clockTime, codeStatus } from './labels'

/** What the desk does when the code's WhatsApp doesn't go. */
const CODE_NEXT = {
  failed: 'Send a new code, or check the client’s number on their page.',
  skipped: 'Tell the Visa HOD: the passports can’t be handed over without the code.',
}

/**
 * "Code from the client" in the handover dialog (docs/decisions/0014-visa-delivered.md Decision 2, amended 23 Oct 2026),
 * as the delivery boy's at the door (0015 Decision 4): Send the code to the client's WhatsApp, then the 6 digits they
 * read out and Check, or Send a new code; where the WhatsApp has got to; once confirmed, when. No code, no handover.
 * `error`: the dialog's own message for this field (pressed Hand over too soon, or the server refused it).
 */
export function HandoverCodeField({ caseNo, disabled, error, onChange }: { caseNo: string; disabled: boolean; error?: string; onChange: () => void }) {
  const [typed, setTyped] = useState('')
  const state = useHandoverCode(caseNo)
  const send = useSendHandoverCode(caseNo)
  const check = useCheckHandoverCode(caseNo)
  const code = state.data ?? null
  const busy = disabled || state.isLoading || send.isPending || check.isPending
  const confirmedAt = code?.confirmedAt ?? null
  const status = confirmedAt === null && code?.message ? codeStatus(code.message, CODE_NEXT) : null
  const problem = issueText(check.error ?? send.error) ?? (state.isError ? issueText(state.error) : null)
  const sendCode = () => {
    check.reset()
    onChange()
    send.mutate(undefined, { onSuccess: () => setTyped('') })
  }
  const checkCode = () => {
    send.reset()
    onChange()
    check.mutate(typed, { onSuccess: () => setTyped('') })
  }

  return (
    <div className="field">
      <span className="lbl">
        Code from the client
        <RequiredMark />
      </span>
      <div className="handover-code">
        {confirmedAt ? (
          <span className="handover-code-done">✓ Confirmed by the client at {clockTime(confirmedAt)}</span>
        ) : code ? (
          <>
            <span className="hint">
              Sent on WhatsApp to {code.sentTo} at {clockTime(code.sentAt)}. Ask the client to read it out.
            </span>
            {status && <span className={status.bad ? 'field-error' : 'hint'}>{status.text}</span>}
            <div className="handover-code-row">
              <input
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6 digits"
                aria-label="The code the client reads out"
                value={typed}
                onChange={(e) => setTyped(digitsOnly(e.target.value).slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typed.length === 6 && !busy) checkCode()
                }}
                disabled={busy}
              />
              <button type="button" className="btn" disabled={busy || typed.length !== 6} onClick={checkCode}>
                {check.isPending ? 'Checking…' : 'Check'}
              </button>
            </div>
            <button type="button" className="btn-link" onClick={sendCode} disabled={busy}>
              {send.isPending ? 'Sending…' : 'Send a new code'}
            </button>
          </>
        ) : (
          <>
            <span className="hint">It goes to the client’s WhatsApp; they read it out to you.</span>
            <button type="button" className="btn" onClick={sendCode} disabled={busy}>
              {send.isPending ? 'Sending…' : 'Send the code'}
            </button>
          </>
        )}
      </div>
      {problem && <span className="field-error">{problem}</span>}
      {!problem && error && <span className="field-error">{error}</span>}
    </div>
  )
}
