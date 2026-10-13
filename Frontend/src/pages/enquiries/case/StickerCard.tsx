import { errorText } from '../../../lib/apiErrors'
import { useDocketSticker } from '../queries'
import type { VisaCase } from '../types'
import { DocketSticker } from './DocketSticker'
import { passportTotal } from './labels'

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
        <div className="sticker-card-body">
          <div
            className="sticker-preview"
            style={{ width: `${s.size.widthMm * PREVIEW_SCALE}mm`, height: `${s.size.heightMm * PREVIEW_SCALE}mm` }}
            aria-label={`Sticker for docket ${s.docketNo}`}
          >
            <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
              <DocketSticker sticker={s} />
            </div>
          </div>
          <div className="sticker-card-side">
            <p className="sticker-card-summary">
              Docket <span className="mono">{s.docketNo}</span> · to {s.vendor.name}, {s.vendor.city}
            </p>
            <div>
              <div className="kv">
                <span>Files</span>
                <strong>{s.cases.length}</strong>
              </div>
              <div className="kv">
                <span>Passports</span>
                <strong>{passportTotal(s.totalPassports, s.totalOldPassports)}</strong>
              </div>
              <div className="kv">
                <span>Label</span>
                <strong>
                  {s.size.widthMm} × {s.size.heightMm} mm
                </strong>
              </div>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={print}>
              Print sticker
            </button>
            <p className="muted small" style={{ margin: 0 }}>
              Opens the label on its own and starts printing. Pick the label printer, or A4 at actual size (100%).
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
