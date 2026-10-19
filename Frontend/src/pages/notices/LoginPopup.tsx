import { useNavigate } from 'react-router'
import { errorText } from '../../lib/apiErrors'
import { HolidayLine, NoticeLine } from './NoticeLines'
import { useDismissLoginPopup, useLoginPopup } from './queries'

/**
 * The visa team's login popup (docs/decisions/0017-today-dashboard.md Decision 12, the demo's "Important for the visa
 * team"): the notices the Head or the Visa HOD picked for it and the holiday-calendar entries still new, shown only when
 * one of them is new to this person. Got it or All updates marks them seen. Mounted in the shell for the visa team.
 */
export function LoginPopup() {
  const navigate = useNavigate()
  const popup = useLoginPopup(true)
  const dismiss = useDismissLoginPopup()
  const items = popup.data ?? []
  if (items.length === 0) return null

  const done = (then?: () => void) => dismiss.mutate(items, { onSuccess: () => then?.() })

  return (
    <div className="overlay overlay-center">
      <div className="dialog dialog-wide login-popup" role="dialog" aria-modal="true" aria-labelledby="login-popup-title">
        <div className="login-popup-head">
          <h2 className="h2" id="login-popup-title">
            Important for the visa team
          </h2>
          <p className="muted small">{items.length === 1 ? '1 new update' : `${items.length} new updates`}</p>
        </div>
        <ul className="notice-feed">
          {items.map((n) => (
            <li key={`${n.kind}-${n.id}`}>{n.kind === 'NOTICE' ? <NoticeLine notice={n} chip="tag" /> : <HolidayLine holiday={n} />}</li>
          ))}
        </ul>
        {dismiss.error && <div className="alert alert-bad">{errorText(dismiss.error)}</div>}
        <div className="login-popup-foot">
          <button type="button" className="btn" disabled={dismiss.isPending} onClick={() => done(() => navigate('/notices?department=VISA'))}>
            All updates
          </button>
          <button type="button" className="btn btn-primary" disabled={dismiss.isPending} onClick={() => done()}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
