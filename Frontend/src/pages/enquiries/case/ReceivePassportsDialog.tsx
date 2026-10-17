import { useState } from 'react'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { formatDate } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useReceivePassports } from '../queries'
import type { StickerCheck, VisaCase } from '../types'
import { bookletsSent, bookletsText, bookletsVsIntake } from './labels'

/**
 * "Mark received" (docs/decisions/0013-visa-passport-back.md Decision 5): the packet is opened at our office and the
 * passports go into our stock. Staff count the booklets into blank boxes, with what went to the vendor beside them (a
 * difference turns red but is allowed), and check each approved traveller's sticker against the passport's name and the
 * dates recorded at Step 6: Matches or Doesn't match. Whoever saves it received them, now. It works whatever the case's
 * status, and a saved receipt isn't changed (decided 17 Oct 2026). A short count holds the handover until the rest come
 * or the shortfall is cleared (Decision 5, amended 17 Oct 2026); the dialog says so.
 */
export function ReceivePassportsDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const { data: me } = useMe()
  const toast = useToast()
  const receive = useReceivePassports(c.caseNo)
  const sent = bookletsSent(c)
  const approved = c.travellers.filter((t) => t.decision?.outcome === 'APPROVED')
  const [current, setCurrent] = useState('')
  const [old, setOld] = useState('')
  const [checks, setChecks] = useState<Record<string, StickerCheck>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const counted = current !== '' && old !== '' ? { current: Number(current), old: Number(old) } : null
  const vs = counted && bookletsVsIntake(counted, sent)
  const short = !!counted && (counted.current < sent.current || counted.old < sent.old)

  const press = () => {
    const missing: Record<string, string> = {}
    if (!counted) missing.booklets = 'Count the current and the old booklets.'
    const unchecked = approved.find((t) => !checks[t.id])
    if (unchecked) missing.stickers = `Check ${unchecked.name ?? unchecked.label}’s sticker.`
    setErrors(missing)
    if (!counted || unchecked) return
    receive.mutate(
      { booklets: counted, stickers: approved.map((t) => ({ travellerId: t.id, check: checks[t.id]! })), updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `${c.caseNo}: passports in our stock.` })
          onClose()
        },
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
        },
      },
    )
  }
  const message = errorBody(receive.error)?.issues ? null : errorText(receive.error)
  const count = (value: string, set: (v: string) => void, label: string) => (
    <label className="field">
      <span className="hint">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={50}
        className="input"
        value={value}
        onChange={(e) => set(e.target.value)}
        disabled={receive.isPending}
        aria-label={`${label} booklets counted`}
      />
    </label>
  )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog submission-dialog" role="dialog" aria-modal="true" aria-labelledby="receive-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="receive-title">
          Mark received
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Open the packet and count what’s in it. The passports go into our stock when you save.
        </p>

        <div className="field">
          <span className="lbl">Booklets counted</span>
          <div className="receive-booklets">
            {count(current, setCurrent, 'Current')}
            {count(old, setOld, 'Old')}
            <span className="muted small">Intake: {bookletsText(sent)}</span>
          </div>
          {counted && vs && (
            <span className={`booklets-vs${vs.matches ? '' : ' is-bad'}`}>
              {bookletsText(counted)} — {vs.text}
            </span>
          )}
          {short && <span className="hint">The handover will wait until the rest arrive or the shortfall is cleared.</span>}
          {errors.booklets && <span className="field-error">{errors.booklets}</span>}
        </div>

        <div className="field">
          <span className="lbl">Visa stickers checked</span>
          {c.recall ? (
            <span className="muted small">Taken back unsubmitted · no stickers to check.</span>
          ) : (
            <>
              <span className="hint" style={{ marginTop: 0 }}>
                Against the passport’s name and the dates recorded at the decision.
              </span>
              {c.travellers.map((t) => {
                const name = t.name ?? t.label
                const d = t.decision
                if (d?.outcome !== 'APPROVED') {
                  return (
                    <div key={t.id} className="decision-row">
                      <strong>{name}</strong>
                      <span className="muted small">Refused · no sticker</span>
                    </div>
                  )
                }
                const check = checks[t.id]
                const pick = (value: StickerCheck) => setChecks((all) => ({ ...all, [t.id]: value }))
                return (
                  <div key={t.id} className="decision-row">
                    <span>
                      <strong>{name}</strong>
                      <span className="mono small muted" style={{ display: 'block' }}>
                        Sticker {d.visaNo} · valid {formatDate(d.validFrom)} – {formatDate(d.validTo)}
                      </span>
                    </span>
                    <span className="seg-btn" role="radiogroup" aria-label={`${name}: sticker`}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={check === 'MATCHES'}
                        className={check === 'MATCHES' ? 'on ok' : ''}
                        disabled={receive.isPending}
                        onClick={() => pick('MATCHES')}
                      >
                        Matches
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={check === 'MISMATCH'}
                        className={check === 'MISMATCH' ? 'on bad' : ''}
                        disabled={receive.isPending}
                        onClick={() => pick('MISMATCH')}
                      >
                        Doesn’t match
                      </button>
                    </span>
                  </div>
                )
              })}
            </>
          )}
          {errors.stickers && <span className="field-error">{errors.stickers}</span>}
        </div>

        <div className="kv">
          <span>Received by</span>
          <strong>{me?.name}, now</strong>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          A passport counts as ours only once the packet is opened and punched at the office.
        </p>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={receive.isPending} onClick={press}>
            {receive.isPending ? 'Saving…' : 'Mark received'}
          </button>
        </div>
      </div>
    </div>
  )
}
