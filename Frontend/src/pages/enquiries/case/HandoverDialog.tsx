import { useState } from 'react'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useHandOver } from '../queries'
import type { VisaCase } from '../types'
import { bookletsText } from './labels'
import { PhotoCapture, type UploadedPhoto } from './PhotoCapture'

/** "Someone else" in the who-collected list: not a traveller on the case. */
const SOMEONE_ELSE = 'someone-else'

/**
 * "Hand over to the client" at the office (docs/decisions/0014-visa-delivered.md Decisions 3–7), for whoever is at the
 * desk: the booklets counted again into blank boxes (they must match our stock, or it's refused: find what's missing
 * first), who collected them (a traveller, or someone else by name) and a photo of that person. Saving it closes the
 * case. The delivery boy's handover comes with his phone screen.
 */
export function HandoverDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const { data: me } = useMe()
  const toast = useToast()
  const hand = useHandOver(c.caseNo)
  const stock = c.passportsReceived?.booklets ?? { current: 0, old: 0 }
  const [current, setCurrent] = useState('')
  const [old, setOld] = useState('')
  const [who, setWho] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const counted = current !== '' && old !== '' ? { current: Number(current), old: Number(old) } : null
  const matches = !!counted && counted.current === stock.current && counted.old === stock.old
  const busy = hand.isPending
  /** A field's message goes as soon as it's changed. */
  const fixed = (field: string) => setErrors((all) => (all[field] ? { ...all, [field]: '' } : all))

  const press = () => {
    const missing: Record<string, string> = {}
    if (!counted) missing.booklets = 'Count the current and the old booklets.'
    else if (!matches) missing.booklets = `Count again: our stock has ${bookletsText(stock)}. Find what’s missing before handing over.`
    if (!who) missing.receiver = 'Pick who collected the passports.'
    else if (who === SOMEONE_ELSE && !name.trim()) missing.receiver = 'Enter the name of the person collecting.'
    if (!photo) missing.photoId = 'Take a photo of the person collecting.'
    setErrors(missing)
    if (!counted || !who || !photo || Object.keys(missing).length) return
    hand.mutate(
      {
        mode: 'OFFICE',
        booklets: counted,
        receiver: who === SOMEONE_ELSE ? { name } : { travellerId: who },
        photoId: photo.id,
        updatedAt: c.updatedAt,
      },
      {
        onSuccess: () => {
          URL.revokeObjectURL(photo.preview)
          toast({ tone: 'ok', message: c.status === 'CANCELLED' ? `${c.caseNo}: passports handed over.` : `${c.caseNo}: passports handed over. The case is closed.` })
          onClose()
        },
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
        },
      },
    )
  }
  const message = errorBody(hand.error)?.issues ? null : errorText(hand.error)
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
        onChange={(e) => {
          set(e.target.value)
          fixed('booklets')
        }}
        disabled={busy}
        aria-label={`${label} booklets handed over`}
      />
    </label>
  )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog submission-dialog" role="dialog" aria-modal="true" aria-labelledby="handover-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="handover-title">
          Hand over to the client
        </h2>
        <span className="seg-btn" role="radiogroup" aria-label="How the passports go back">
          <button type="button" role="radio" aria-checked className="on">
            Client collects from office
          </button>
          <button type="button" role="radio" aria-checked={false} disabled title="Comes next, with the delivery boy’s screen">
            Our delivery boy
          </button>
        </span>

        <div className="field">
          <span className="lbl">Booklets counted</span>
          <div className="receive-booklets">
            {count(current, setCurrent, 'Current')}
            {count(old, setOld, 'Old')}
            <span className="muted small">In our stock: {bookletsText(stock)}</span>
          </div>
          {counted && (
            <span className={`booklets-vs${matches ? '' : ' is-bad'}`}>
              {bookletsText(counted)} — {matches ? 'matches our stock' : 'doesn’t match our stock: find what’s missing first'}
            </span>
          )}
          {errors.booklets && <span className="field-error">{errors.booklets}</span>}
        </div>

        <div className="field">
          <span className="lbl">Who collected them</span>
          <div className="receiver-options" role="radiogroup" aria-label="Who collected them">
            {c.travellers.map((t) => (
              <label key={t.id}>
                <input
                  type="radio"
                  name="receiver"
                  checked={who === t.id}
                  onChange={() => {
                    setWho(t.id)
                    fixed('receiver')
                  }}
                  disabled={busy}
                />
                {t.name ?? t.label}
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="receiver"
                checked={who === SOMEONE_ELSE}
                onChange={() => {
                  setWho(SOMEONE_ELSE)
                  fixed('receiver')
                }}
                disabled={busy}
              />
              Someone else
            </label>
            {who === SOMEONE_ELSE && (
              <input
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  fixed('receiver')
                }}
                placeholder="Their name"
                aria-label="Name of the person collecting"
                disabled={busy}
                autoFocus
              />
            )}
          </div>
          {errors.receiver && <span className="field-error">{errors.receiver}</span>}
        </div>

        <div className="field">
          <span className="lbl">Photo of the person collecting</span>
          <PhotoCapture
            caseNo={c.caseNo}
            value={photo}
            onChange={(p) => {
              setPhoto(p)
              fixed('photoId')
            }}
            disabled={busy}
          />
          {errors.photoId && <span className="field-error">{errors.photoId}</span>}
        </div>

        <div className="kv">
          <span>Handed over by</span>
          <strong>{me?.name}, now</strong>
        </div>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={press}>
            {busy ? 'Saving…' : 'Hand over'}
          </button>
        </div>
      </div>
    </div>
  )
}
