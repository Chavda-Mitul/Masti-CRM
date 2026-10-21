import { useEffect, useRef, type MouseEvent } from 'react'
import {
  MAX_LETTER_CELL_CHARS,
  MAX_LETTER_COLUMNS,
  MAX_LETTER_HEADING_CHARS,
  MAX_LETTER_PART_CHARS,
  MAX_LETTER_ROWS,
  marksIn,
  type LetterTable,
  type LetterText,
} from '../../../lib/letter'

/**
 * "Edit the letter" (docs/decisions/0019-covering-letters.md amendment 1): every part of the case's letter, the table
 * included, as plain text. Changes go straight to the card, which keeps them until "Make the letter"; Done, Escape or a
 * click outside only closes this, so nothing is lost by closing it.
 */
export function CoveringLetterEditor({
  letter,
  onChange,
  onClose,
}: {
  letter: LetterText
  onChange: (letter: LetterText) => void
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

  const { table } = letter
  const setTable = (next: LetterTable) => onChange({ ...letter, table: next })
  const marks = marksIn(letter)

  return (
    <div className="overlay overlay-center" {...overlay}>
      <div className="dialog covering-letter-dialog covering-letter-editor" role="dialog" aria-modal="true" aria-label="Edit the letter">
        <h2 className="h2">Edit the letter</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Change anything you need. A blank line starts a new paragraph. Type over each{' '}
          <span className="letter-blank letter-mark">⟦mark⟧</span> with what it asks for, or delete it.
        </p>

        <label className="field">
          <span>{table ? 'Above the table' : 'The letter'}</span>
          <textarea
            className="input textarea covering-letter-text"
            rows={table ? 14 : 22}
            maxLength={MAX_LETTER_PART_CHARS}
            value={letter.top}
            onChange={(e) => onChange({ ...letter, top: e.target.value })}
          />
        </label>

        {table && <TableEditor table={table} onChange={setTable} />}

        {table && (
          <label className="field">
            <span>Below the table</span>
            <textarea
              className="input textarea covering-letter-text"
              rows={10}
              maxLength={MAX_LETTER_PART_CHARS}
              value={letter.bottom}
              onChange={(e) => onChange({ ...letter, bottom: e.target.value })}
            />
          </label>
        )}

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

/** The table's headings and cells, with rows and columns added or removed. */
function TableEditor({ table, onChange }: { table: LetterTable; onChange: (table: LetterTable) => void }) {
  const { columns, rows } = table
  const heading = (c: number) => columns[c] || `column ${c + 1}`
  const setHeading = (c: number, value: string) => onChange({ columns: columns.map((h, i) => (i === c ? value : h)), rows })
  const setCell = (r: number, c: number, value: string) =>
    onChange({ columns, rows: rows.map((cells, i) => (i === r ? cells.map((cell, j) => (j === c ? value : cell)) : cells)) })
  const addRow = () => onChange({ columns, rows: [...rows, columns.map(() => '')] })
  const removeRow = (r: number) => onChange({ columns, rows: rows.filter((_, i) => i !== r) })
  const addColumn = () => onChange({ columns: [...columns, ''], rows: rows.map((cells) => [...cells, '']) })
  const removeColumn = (c: number) =>
    onChange({ columns: columns.filter((_, i) => i !== c), rows: rows.map((cells) => cells.filter((_, j) => j !== c)) })

  return (
    <div className="field">
      <span>The table</span>
      <div className="covering-letter-table-edit">
        <table className="table">
          <thead>
            <tr>
              {columns.map((h, c) => (
                <th key={c}>
                  <div className="covering-letter-heading">
                    <input
                      className="input"
                      value={h}
                      maxLength={MAX_LETTER_HEADING_CHARS}
                      onChange={(e) => setHeading(c, e.target.value)}
                      aria-label={`Heading of column ${c + 1}`}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => removeColumn(c)}
                      disabled={columns.length === 1}
                      aria-label={`Remove the column ${heading(c)}`}
                    >
                      ✕
                    </button>
                  </div>
                </th>
              ))}
              <th aria-label="Remove a row" />
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, r) => (
              <tr key={r}>
                {cells.map((cell, c) => (
                  <td key={c}>
                    <input
                      className="input"
                      value={cell}
                      maxLength={MAX_LETTER_CELL_CHARS}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      aria-label={`Row ${r + 1}, ${heading(c)}`}
                    />
                  </td>
                ))}
                <td>
                  <div className="row-actions">
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRow(r)} aria-label={`Remove row ${r + 1}`}>
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="covering-letter-actions">
        <button type="button" className="btn btn-sm" onClick={addRow} disabled={rows.length >= MAX_LETTER_ROWS}>
          Add a row
        </button>
        <button type="button" className="btn btn-sm" onClick={addColumn} disabled={columns.length >= MAX_LETTER_COLUMNS}>
          Add a column
        </button>
      </div>
    </div>
  )
}
