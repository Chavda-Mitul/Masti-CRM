import { useState } from 'react'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useClearShortfall, useReceiveRest } from '../queries'
import type { VisaCase } from '../types'
import { bookletsText, dayTime, passportsMissing } from './labels'

type Choice = 'CAME' | 'GONE'

/**
 * "The missing passport" (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026): fewer booklets
 * came back than went out, so the handover waits. Whoever can act on the case settles it, whatever the case's status:
 * it came (the late booklets are counted into our stock, each kind up to what's missing), or it won't come back (the
 * shortfall is cleared with a reason from the list ⚠️, and the handover goes ahead with what's in our stock). Once
 * cleared, only "It came" is left, for one that turns up after all.
 */
export function ShortfallDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const { data: me } = useMe()
  const toast = useToast()
  const rest = useReceiveRest(c.caseNo)
  const clear = useClearShortfall(c.caseNo)
  const r = c.passportsReceived!
  const m = r.missing
  const cleared = r.shortfallCleared
  const reasons = useMasterList('missing-passport-reasons', !cleared)
  const options = (reasons.data ?? []).filter((x) => x.isActive)
  const [choice, setChoice] = useState<Choice | null>(cleared ? 'CAME' : null)
  const [current, setCurrent] = useState('')
  const [old, setOld] = useState('')
  const [reasonId, setReasonId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const one = m.current + m.old === 1
  const pending = rest.isPending || clear.isPending
  const counted =
    (m.current === 0 || current !== '') && (m.old === 0 || old !== '')
      ? { current: m.current > 0 ? Number(current) : 0, old: m.old > 0 ? Number(old) : 0 }
      : null

  const onError = (err: unknown) => {
    const issues = errorBody(err)?.issues ?? {}
    setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
  }
  const press = () => {
    if (choice === 'CAME') {
      const missing = !counted ? 'Count the booklets that came.' : counted.current + counted.old < 1 ? 'Count at least one booklet.' : null
      setErrors(missing ? { booklets: missing } : {})
      if (!counted || missing) return
      const all = counted.current === m.current && counted.old === m.old
      rest.mutate(
        { booklets: counted, updatedAt: c.updatedAt },
        {
          onSuccess: () => {
            toast({ tone: 'ok', message: all ? `${c.caseNo}: everything is back in our stock.` : `${c.caseNo}: added to our stock.` })
            onClose()
          },
          onError,
        },
      )
    } else if (choice === 'GONE') {
      setErrors(reasonId ? {} : { reasonId: one ? 'Pick why it won’t come back.' : 'Pick why they won’t come back.' })
      if (!reasonId) return
      clear.mutate(
        { reasonId: Number(reasonId), updatedAt: c.updatedAt },
        {
          onSuccess: () => {
            toast({ tone: 'ok', message: `${c.caseNo}: shortfall cleared. The handover can go ahead.` })
            onClose()
          },
          onError,
        },
      )
    }
  }
  const failed = choice === 'GONE' ? clear.error : rest.error
  const message = errorBody(failed)?.issues ? null : errorText(failed)
  const count = (value: string, set: (v: string) => void, label: string, max: number) => (
    <label className="field">
      <span className="hint">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        className="input"
        value={value}
        onChange={(e) => set(e.target.value)}
        disabled={pending}
        aria-label={`${label} booklets that came`}
      />
    </label>
  )
  const pick = (value: Choice) => {
    setChoice(value)
    setErrors({})
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog submission-dialog" role="dialog" aria-modal="true" aria-labelledby="shortfall-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="shortfall-title">
          {one ? 'The missing passport' : 'The missing passports'}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {passportsMissing(m)} went to the vendor and {one ? 'hasn’t' : 'haven’t'} come back. Our stock has {bookletsText(r.booklets)}.
        </p>
        {cleared ? (
          <p className="muted small" style={{ margin: 0 }}>
            Cleared by {cleared.by?.name ?? '—'}, {dayTime(cleared.at)}: {cleared.reason}. If {one ? 'it turns' : 'one turns'} up after all,
            count it in here.
          </p>
        ) : (
          <div className="field">
            <span className="lbl">What happened?</span>
            <span className="seg-btn" role="radiogroup" aria-label="What happened">
              <button type="button" role="radio" aria-checked={choice === 'CAME'} className={choice === 'CAME' ? 'on' : ''} disabled={pending} onClick={() => pick('CAME')}>
                {one ? 'It came' : 'Some came'}
              </button>
              <button type="button" role="radio" aria-checked={choice === 'GONE'} className={choice === 'GONE' ? 'on' : ''} disabled={pending} onClick={() => pick('GONE')}>
                {one ? 'It won’t come back' : 'They won’t come back'}
              </button>
            </span>
          </div>
        )}

        {choice === 'CAME' && (
          <div className="field">
            <span className="lbl">Booklets that came</span>
            <div className="receive-booklets">
              {m.current > 0 && count(current, setCurrent, 'Current', m.current)}
              {m.old > 0 && count(old, setOld, 'Old', m.old)}
              <span className="muted small">Missing: {bookletsText(m)}</span>
            </div>
            {errors.booklets && <span className="field-error">{errors.booklets}</span>}
          </div>
        )}
        {choice === 'GONE' && (
          <>
            <label className="field">
              <span className="lbl">{one ? 'Why it won’t come back' : 'Why they won’t come back'}</span>
              <select className="select" value={reasonId} onChange={(e) => setReasonId(e.target.value)} disabled={pending}>
                <option value="">{reasons.isPending ? 'Loading…' : 'Pick the reason…'}</option>
                {options.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              {errors.reasonId && <span className="field-error">{errors.reasonId}</span>}
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              The handover then goes ahead with what’s in our stock: {bookletsText(r.booklets)}.
            </p>
          </>
        )}
        {choice && (
          <div className="kv">
            <span>{choice === 'CAME' ? 'Received by' : 'Cleared by'}</span>
            <strong>{me?.name}, now</strong>
          </div>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {choice === 'CAME' && (
            <button type="button" className="btn btn-primary" disabled={pending} onClick={press}>
              {pending ? 'Saving…' : 'Add to our stock'}
            </button>
          )}
          {choice === 'GONE' && (
            <button type="button" className="btn btn-danger" disabled={pending} onClick={press}>
              {pending ? 'Clearing…' : 'Clear the shortfall'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
