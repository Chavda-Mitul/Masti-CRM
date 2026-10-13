import { errorText } from '../../../lib/apiErrors'
import { useDocketSticker } from '../queries'
import type { VisaCase } from '../types'
import { DocketSticker } from './DocketSticker'

/** The preview's size against the real label. */
const PREVIEW_SCALE = 0.62

/**
 * "Sticker" (demo screen 09 ⚠️, docs/decisions/0008-visa-docket-dispatch.md Decision 5): the docket's parcel label,
 * scaled down, and Print sticker, which opens the label alone in a new tab at its real size and starts printing.
 * Anyone who can open the case can print it, a dispatched docket's too.
 */
export function StickerCard({ visaCase: c }: { visaCase: VisaCase }) {
  const sticker = useDocketSticker(c.caseNo, !!c.docket)
  if (!c.docket) return null

  const s = sticker.data
  const print = () => window.open(`/print/sticker/${encodeURIComponent(c.caseNo)}?autoprint=1`, '_blank')

  return (
    <section className="card pad sticker-card">
      <h2 className="h2">Sticker</h2>
      {sticker.isPending && <p className="muted small">Loading…</p>}
      {sticker.isError && <div className="alert alert-bad">{errorText(sticker.error) ?? 'Couldn’t load the sticker.'}</div>}
      {s && (
        <>
          <div
            className="sticker-preview"
            style={{ width: `${s.size.widthMm * PREVIEW_SCALE}mm`, height: `${s.size.heightMm * PREVIEW_SCALE}mm` }}
            aria-label={`Sticker for docket ${s.docketNo}`}
          >
            <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
              <DocketSticker sticker={s} />
            </div>
          </div>
          <div className="sticker-card-actions">
            <button type="button" className="btn btn-sm" onClick={print}>
              Print sticker
            </button>
            <span className="muted small">
              {s.size.widthMm} × {s.size.heightMm} mm label
            </span>
          </div>
        </>
      )}
    </section>
  )
}
