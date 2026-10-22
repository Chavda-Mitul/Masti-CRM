import { useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'react-router'
import { LetterTextPaper } from '../../components/LetterPaper'
import { errorText } from '../../lib/apiErrors'
import '../../styles/print.css'
import { useCoveringLetterPrint } from '../enquiries/queries'

/** Every page's margins on A4, in millimetres; the first page's top is the letterhead space instead. */
const EDGE_MM = 18
const SIDE_MM = 20

/**
 * The covering letter made for a case, on A4, for printing on the client's letterhead
 * (docs/decisions/0019-covering-letters.md Decisions 10 and 11). Outside the app shell, so nothing else prints. The
 * first page leaves the letterhead space set in Settings at the top; "Plain paper" leaves the usual margin instead. It is
 * the letter as it was made, staff's changes included (amendment 1), every time.
 */
export function CoveringLetterPrintPage() {
  const { caseNo = '' } = useParams()
  const letter = useCoveringLetterPrint(caseNo)
  const [plain, setPlain] = useState(false)

  // The browser names the tab and the saved PDF after the title: "VISA-2026-0001_Covering_letter".
  useEffect(() => {
    if (!letter.data) return
    const before = document.title
    document.title = `${letter.data.caseNo}_Covering_letter`
    return () => {
      document.title = before
    }
  }, [letter.data])

  if (letter.isPending) return <p className="print-note">Loading…</p>
  if (letter.isError) return <p className="print-note">{errorText(letter.error) ?? 'Couldn’t load the covering letter.'}</p>

  const p = letter.data
  const topMm = plain ? EDGE_MM : Math.max(p.letterheadMm, EDGE_MM)
  return (
    <div className="print-page letter-print">
      <style>{`@page { size: A4; margin: ${EDGE_MM}mm ${SIDE_MM}mm; } @page :first { margin-top: ${topMm}mm; }`}</style>
      <div className="print-toolbar">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.close()}>
          Close
        </button>
        <label className="check">
          <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
          <span>Plain paper</span>
        </label>
        <span className="muted small">
          {plain ? 'No letterhead: the usual margin at the top.' : `Load the client’s letterhead: ${topMm} mm is left blank at the top.`} Print
          at actual size (100%).
        </span>
      </div>
      <div className="letter-sheet" style={{ '--letter-top': `${topMm}mm`, '--letter-edge': `${EDGE_MM}mm`, '--letter-side': `${SIDE_MM}mm` } as CSSProperties}>
        <LetterTextPaper text={p.letter} />
      </div>
    </div>
  )
}
