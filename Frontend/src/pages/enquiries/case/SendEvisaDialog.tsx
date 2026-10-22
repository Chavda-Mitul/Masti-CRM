import { useQueryClient } from '@tanstack/react-query'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { enquiryKeys, useSendEvisa, useSendEvisaCheck } from '../queries'
import type { SendEvisaCheck, VisaCase } from '../types'
import { dayTime, firstName } from './labels'

/**
 * "Send the e-visa" (docs/decisions/0025-evisa-after-decision.md, part 3): each approved traveller's e-visa goes to the
 * client on WhatsApp, one message each with their PDF. Refused until every approved traveller's PDF is uploaded and
 * marked Matches. Then the case is Delivered and closes, or, when we hold the client's passports, it waits for the
 * handover.
 */
export function SendEvisaDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const check = useSendEvisaCheck(c.caseNo)
  const send = useSendEvisa(c.caseNo)

  // The server's list wins when it disagrees (a PDF or a check changed meanwhile).
  const serverBlockers =
    errorCode(send.error) === 'SEND_BLOCKED' ? (errorBody(send.error)?.details?.blockers as SendEvisaCheck['blockers'] | undefined) : undefined
  const blockers = serverBlockers ?? check.data?.blockers ?? []
  const message = serverBlockers ? null : errorText(send.error)
  const ready = !!check.data && blockers.length === 0
  const passports = (n: number) => `${n} ${n === 1 ? 'passport' : 'passports'}`

  const press = () =>
    send.mutate(
      { updatedAt: c.updatedAt },
      {
        onSuccess: (updated) => {
          toast({
            tone: 'ok',
            message: updated.status === 'CLOSED' ? `E-visa sent. ${c.caseNo} is delivered and closed.` : 'E-visa sent. Now hand back the passports.',
          })
          onClose()
        },
        onError: (err) => {
          if (errorCode(err) === 'SEND_BLOCKED') void queryClient.invalidateQueries({ queryKey: enquiryKeys.sendEvisaCheck(c.caseNo) })
        },
      },
    )
  const fixFirst = () => {
    onClose()
    document.querySelector('.decision-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog dispatch-dialog" role="dialog" aria-modal="true" aria-labelledby="send-evisa-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="send-evisa-title">
          Send the e-visa
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Each approved traveller’s e-visa goes to the client on WhatsApp, one message each with their PDF.
        </p>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : blockers.length > 0 ? (
          <div className="alert alert-warn">
            <strong>Not ready yet.</strong>
            <ul className="missing-list">
              {blockers.map((b) => (
                <li key={`${b.travellerId}-${b.kind}`}>{b.label}</li>
              ))}
            </ul>
            <button type="button" className="btn-link" onClick={fixFirst}>
              Go to the Decision card →
            </button>
          </div>
        ) : (
          <div className="dispatch-files">
            {check.data.travellers.map((t) => (
              <div key={t.name} className="kv">
                <span>{t.name}</span>
                <strong className="mono small">{t.fileName}</strong>
              </div>
            ))}
            <p className="muted small" style={{ margin: 0 }}>
              {check.data.closes ? (
                <>
                  Then the case is <strong>Delivered</strong> and closes.
                </>
              ) : (
                <>
                  We hold {passports(check.data.held)} for this case: it waits for the handover, due{' '}
                  {c.owner && <>on {firstName(c.owner.name)}’s desk </>}
                  <strong>{check.data.dueAt && dayTime(check.data.dueAt)}</strong>.
                </>
              )}
            </p>
          </div>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || send.isPending} onClick={press} autoFocus>
            {send.isPending ? 'Sending…' : 'Send to the client'}
          </button>
        </div>
      </div>
    </div>
  )
}
