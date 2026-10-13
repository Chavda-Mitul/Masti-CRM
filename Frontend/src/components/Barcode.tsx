import JsBarcode from 'jsbarcode'
import { useEffect, useRef } from 'react'

/**
 * A Code 128 barcode of `value` (the docket number on the parcel sticker, 0008 Decision 5). The bars stretch to the
 * box the CSS gives the svg; the value itself is printed as text by the caller. `onDrawn` runs once the bars are in.
 */
export function Barcode({ value, className, onDrawn }: { value: string; className?: string; onDrawn?: () => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const drawn = useRef(onDrawn)
  // Before the drawing effect below, so it calls the latest callback.
  useEffect(() => {
    drawn.current = onDrawn
  }, [onDrawn])

  useEffect(() => {
    const el = svg.current
    if (!el) return
    JsBarcode(el, value, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 80, background: 'transparent' })
    // JsBarcode sizes the svg in pixels; a viewBox lets the label's millimetre box decide instead.
    const width = parseFloat(el.getAttribute('width') ?? '0')
    const height = parseFloat(el.getAttribute('height') ?? '0')
    el.setAttribute('viewBox', `0 0 ${width} ${height}`)
    el.setAttribute('preserveAspectRatio', 'none')
    el.removeAttribute('width')
    el.removeAttribute('height')
    el.style.removeProperty('transform')
    drawn.current?.()
  }, [value])

  return <svg ref={svg} className={className} role="img" aria-label={`Barcode ${value}`} data-value={value} />
}
