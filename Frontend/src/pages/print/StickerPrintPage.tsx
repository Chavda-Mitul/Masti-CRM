import { useCallback, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { errorText, lostAccess } from '../../lib/apiErrors'
import '../../styles/print.css'
import { DocketSticker } from '../enquiries/case/DocketSticker'
import { useDocketSticker } from '../enquiries/queries'

/**
 * The parcel sticker alone, at its real size, for printing (docs/decisions/0008-visa-docket-dispatch.md Decision 5).
 * Outside the app shell, so nothing else prints. The Sticker card opens it with ?autoprint=1 and the print dialog opens
 * once the barcode is drawn; opened any other way it waits for Print.
 */
export function StickerPrintPage() {
  const { caseNo = '' } = useParams()
  const [params] = useSearchParams()
  const sticker = useDocketSticker(caseNo)
  const printed = useRef(false)
  const autoprint = params.get('autoprint') === '1'
  const docketNo = sticker.data?.docketNo

  // The browser names the tab and the saved PDF after the title: "D-2026-0001_Sticker". This effect runs before the
  // print below, which waits on a promise.
  useEffect(() => {
    if (!docketNo) return
    const before = document.title
    document.title = `${docketNo}_Sticker`
    return () => {
      document.title = before
    }
  }, [docketNo])

  const onDrawn = useCallback(() => {
    if (!autoprint || printed.current) return
    printed.current = true
    // After the fonts and the bars are painted.
    void document.fonts.ready.then(() => window.print())
  }, [autoprint])

  if (sticker.isPending) return <p className="print-note">Loading…</p>
  if (sticker.isLoadingError || lostAccess(sticker)) return <p className="print-note">{errorText(sticker.error) ?? 'Couldn’t load the sticker.'}</p>

  const { widthMm, heightMm } = sticker.data.size
  return (
    <div className="print-page">
      {/* The page is the label: a thermal printer feeds exactly one; on A4 it prints at its true size. */}
      <style>{`@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`}</style>
      <div className="print-toolbar">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.close()}>
          Close
        </button>
        <span className="muted small">
          {widthMm} × {heightMm} mm label. In the print dialog, pick the label printer, or print on A4 at actual size (100%).
        </span>
      </div>
      <DocketSticker sticker={sticker.data} onDrawn={onDrawn} />
    </div>
  )
}
