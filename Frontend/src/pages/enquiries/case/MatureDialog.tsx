import { useNavigate } from 'react-router'
import { isHodOf } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useMatureCase } from '../queries'
import type { MaturityMissing, VisaCase } from '../types'
import { xeroxForOriginal } from './labels'

/** What the loaded case still lacks: the same rule the backend checks (0006 Decision 8). Booklets are optional. */
function missingOf(c: VisaCase): MaturityMissing {
  return {
    unnamed: c.travellers.filter((t) => !t.member).map((t) => t.label),
    pending: c.travellers
      .map((t) => ({ traveller: t.member?.name ?? t.label, documents: t.documents.filter((d) => d.status === 'PENDING').map((d) => d.name) }))
      .filter((p) => p.documents.length > 0),
  }
}

const isEmpty = (m: MaturityMissing) => m.unnamed.length === 0 && m.pending.length === 0

/** Papers that came in with no scan kept for the next trip (0016 Decision 7): a warning only, never in the way. */
const noScanOf = (c: VisaCase) =>
  c.travellers
    .map((t) => ({ traveller: t.member?.name ?? t.label, documents: t.documents.filter((d) => d.noScan).map((d) => d.name) }))
    .filter((p) => p.documents.length > 0)

/**
 * "Mark documents complete" (0006 Decision 8). Lists what is still missing before anything is sent; once everything is in,
 * the case goes to the HOD to pick a processor. Staff lose sight of it then, so they are taken back to the list.
 */
export function MatureDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const { data: me } = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const mature = useMatureCase(c.caseNo)

  // The server's list wins when it disagrees (someone un-ticked a paper meanwhile).
  const serverMissing = errorCode(mature.error) === 'NOT_READY' ? (errorBody(mature.error)?.details?.missing as MaturityMissing | undefined) : undefined
  const missing = serverMissing ?? missingOf(c)
  const ready = isEmpty(missing)
  const noScan = noScanOf(c)
  const staysWithMe = !!me && isHodOf(me, c.department.code)
  const message = serverMissing ? null : errorText(mature.error)
  // Allowed, but worth a look before the file goes out (decided 19 Oct 2026).
  const xerox = c.travellers.flatMap((t) => t.documents.filter(xeroxForOriginal).map((d) => `${t.member?.name ?? t.label}'s ${d.name}`))

  const submit = () =>
    mature.mutate(
      { updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          if (staysWithMe) {
            toast({ tone: 'ok', message: 'Documents complete. Pick a processor for this case.' })
            onClose()
          } else {
            toast({ tone: 'ok', message: 'Handed over. The HOD will pick a processor.' })
            void navigate('/enquiries', { replace: true })
          }
        },
      },
    )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="mature-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="mature-title">
          Mark documents complete
        </h2>

        {ready ? (
          <p style={{ margin: 0 }}>
            All documents are in. The case moves to File preparation and goes to the HOD to pick a processor.
            {!staysWithMe && ' You won’t see this case after this.'}
          </p>
        ) : (
          <div className="alert alert-warn">
            <strong>Not everything is in yet.</strong>
            <ul className="missing-list">
              {missing.unnamed.map((label) => (
                <li key={`name-${label}`}>Name {label}</li>
              ))}
              {missing.pending.map((p) => (
                <li key={`docs-${p.traveller}`}>
                  <strong>{p.traveller}:</strong> {p.documents.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {noScan.length > 0 && (
          <div className="alert alert-warn">
            <strong>No scan saved yet</strong> (you can still mark complete):
            <ul className="missing-list">
              {noScan.map((p) => (
                <li key={`scan-${p.traveller}`}>
                  <strong>{p.traveller}:</strong> {p.documents.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {xerox.length > 0 && (
          <p className="hint" style={{ margin: 0 }}>
            <strong>Came as a xerox, though the checklist needs the original:</strong> {xerox.join('; ')}. You can still mark
            complete; get the original before the file goes out.
          </p>
        )}
        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || mature.isPending} onClick={submit}>
            {mature.isPending ? 'Saving…' : 'Mark complete'}
          </button>
        </div>
      </div>
    </div>
  )
}
