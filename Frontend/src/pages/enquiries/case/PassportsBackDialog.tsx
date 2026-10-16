import { useState } from 'react'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { istParts, istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useSendPassportsBack } from '../queries'
import type { VisaCase } from '../types'
import { firstName, longDate, passportTotal } from './labels'
import { OpenDayCalendar } from './OpenDayCalendar'

/**
 * "Passports on the way back" (docs/decisions/0013-visa-passport-back.md Decision 3), at Step 6, or at Step 7 for a
 * recalled file: the day the vendor collected the passports and the day they're expected at our office, an open office
 * day. The case moves to Passport back, in transit, due back on its processor's desk that day.
 */
export function PassportsBackDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const send = useSendPassportsBack(c.caseNo)
  const today = istToday()
  const dispatchedOn = c.docket?.dispatchedAt ? istParts(c.docket.dispatchedAt).date : undefined
  const [collectedOn, setCollectedOn] = useState(today)
  const [expectedOn, setExpectedOn] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // What intake counted (0006), or one per traveller when nobody did: the same booklets come back.
  const booklets = passportTotal(c.booklets.current ?? c.travellers.length, c.booklets.old ?? 0)

  const press = () => {
    const missing: Record<string, string> = {}
    if (!collectedOn) missing.collectedOn = 'Pick the day the vendor collected the passports.'
    if (!expectedOn) missing.expectedOn = 'Pick the day the passports are expected at our office.'
    setErrors(missing)
    if (!collectedOn || !expectedOn) return
    send.mutate(
      { collectedOn, expectedOn, updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `${c.caseNo}: passports on the way back, expected ${longDate(expectedOn)}.` })
          onClose()
        },
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
        },
      },
    )
  }
  const message = errorBody(send.error)?.issues ? null : errorText(send.error)

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog submission-dialog" role="dialog" aria-modal="true" aria-labelledby="passports-back-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="passports-back-title">
          Passports on the way back
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {booklets} for {c.client.name}. Vendors don’t always send a docket number, so we keep the day we expect them.
          The case comes back {c.owner ? `on ${firstName(c.owner.name)}’s desk ` : ''}that day.
        </p>

        <label className="field">
          <span className="lbl">Vendor collected them on</span>
          <input
            type="date"
            className="input"
            value={collectedOn}
            min={dispatchedOn}
            max={today}
            onChange={(e) => setCollectedOn(e.target.value)}
            disabled={send.isPending}
          />
          {errors.collectedOn && <span className="field-error">{errors.collectedOn}</span>}
        </label>

        <div className="field">
          <span className="lbl">Expected at our office</span>
          <span className="hint" style={{ marginTop: 0 }}>
            Sundays and our office’s holidays can’t be picked.
          </span>
          <OpenDayCalendar
            target={{ office: true }}
            label="Expected at our office"
            value={expectedOn}
            onChange={setExpectedOn}
            allowToday
            disabled={send.isPending}
          />
          {errors.expectedOn && <span className="field-error">{errors.expectedOn}</span>}
        </div>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={send.isPending} onClick={press}>
            {send.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
