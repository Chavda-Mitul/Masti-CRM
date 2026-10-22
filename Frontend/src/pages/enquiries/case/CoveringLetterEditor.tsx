import { useEffect, useRef, type MouseEvent } from 'react'
import { LetterTextPaper } from '../../../components/LetterPaper'
import { pasteTable } from '../../../components/pasteTable'
import { MAX_CASE_LETTER_CHARS, marksIn } from '../../../lib/letter'

/**
 * "Edit the letter" (docs/decisions/0019-covering-letters.md amendments 1 and 3): the case's letter as one text, with the
 * letter drawn beside it as it will print. Lines with | between the columns are tables. Changes go straight to the card,
 * which keeps them until "Make the letter"; Done, Escape or a click outside only closes this, so nothing is lost by
 * closing it.
 */
export function CoveringLetterEditor({
  letter,
  onChange,
  onClose,
}: {
  letter: string
  onChange: (letter: string) => void
  onClose: () => void
}) {
  // A click outside closes it only when the press began outside too, so a selection dragged out of a box doesn't.
  const pressedOutside = useRef(false)
  const overlay = {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      pressedOutside.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.target === e.currentTarget && pressedOutside.current) onClose()
      pressedOutside.current = false
    },
  }
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const marks = marksIn(letter)

  return (
    <div className="overlay overlay-center" {...overlay}>
      <div className="dialog covering-letter-dialog covering-letter-editor" role="dialog" aria-modal="true" aria-label="Edit the letter">
        <h2 className="h2">Edit the letter</h2>
        <p className="muted small" style={{ margin: 0 }}>
          A blank line starts a new paragraph. Lines with | between the columns make a table, and its first line is the
          headings: use / elsewhere. Type over each <span className="letter-blank letter-mark">⟦mark⟧</span> with what it
          asks for, or delete it.
        </p>

        <div className="covering-letter-panes">
          <label className="field">
            <span>The letter</span>
            <textarea
              className="input textarea covering-letter-text"
              maxLength={MAX_CASE_LETTER_CHARS}
              value={letter}
              onChange={(e) => onChange(e.target.value)}
              onPaste={pasteTable(onChange)}
            />
          </label>
          <div className="field">
            <span>As it will print</span>
            <div className="covering-letter-live">
              <LetterTextPaper text={letter} />
            </div>
          </div>
        </div>

        <div className="covering-letter-actions" style={{ justifyContent: 'space-between' }}>
          <span className="muted small" role="status">
            {marks.length > 0 ? `Still to fill in: ${marks.join('; ')}.` : 'Nothing left to fill in.'}
          </span>
          <button type="button" className="btn btn-dark" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
