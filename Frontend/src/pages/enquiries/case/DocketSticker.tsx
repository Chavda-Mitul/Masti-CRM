import { Barcode } from '../../../components/Barcode'
import '../../../styles/sticker.css'
import type { DocketStickerData } from '../types'
import { passportTotal } from './labels'

/** "VISA-2026-0001 (2)", "VISA-2026-0002 (3 +2 old)" */
const caseLine = (c: DocketStickerData['cases'][number]) => `${c.caseNo} (${c.passports}${c.oldPassports > 0 ? ` +${c.oldPassports} old` : ''})`

/**
 * The parcel sticker (demo screen 09 ⚠️, docs/decisions/0008-visa-docket-dispatch.md Decision 5), at its real size in
 * millimetres (the visa.sticker setting, 100 × 150 mm): who it is from and the docket number, the vendor it goes to,
 * each file with its passports and the total, the docket number as a Code 128 barcode, and Masti's address. The Sticker
 * card shows it scaled down; the print page prints it.
 */
export function DocketSticker({ sticker: s, onDrawn }: { sticker: DocketStickerData; onDrawn?: () => void }) {
  return (
    <div className="sticker" style={{ width: `${s.size.widthMm}mm`, height: `${s.size.heightMm}mm` }}>
      <div className="sticker-head">
        <span className="sticker-company">{s.from.name}</span>
        <span className="sticker-no">{s.docketNo}</span>
      </div>
      <div className="sticker-block">
        <span className="sticker-lbl">To</span>
        <span className="sticker-to">
          {s.vendor.name}, {s.vendor.city}
        </span>
      </div>
      <div className="sticker-block">
        <span className="sticker-lbl">Files</span>
        <span className="sticker-cases">{s.cases.map(caseLine).join(' · ')}</span>
        <span className="sticker-total">{passportTotal(s.totalPassports, s.totalOldPassports)}</span>
      </div>
      <div className="sticker-code">
        <Barcode value={s.docketNo} className="sticker-bars" onDrawn={onDrawn} />
        <span className="sticker-code-text">{s.docketNo}</span>
      </div>
      <div className="sticker-from">
        <span className="sticker-lbl">From</span>
        <span>
          <strong>{s.from.name}</strong>
          <br />
          {s.from.address}
          <br />
          {s.from.phone}
        </span>
      </div>
    </div>
  )
}
