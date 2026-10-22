import { Fragment, type ReactNode } from 'react'
import { letterBlocks, textBlocks, type LetterBlock, type LetterPiece } from '../lib/letter'
import '../styles/letter.css'

/** One row of the letter's table of travellers. */
export interface LetterTraveller {
  name: string
  relation: string
  dateOfBirth: string
  passportNo: string
}

/** Draws a line of pieces: its words, and each blank or mark as the paper shows it. */
type DrawLine = (pieces: LetterPiece[]) => ReactNode

/**
 * A covering letter drawn like the page it prints on (docs/decisions/0019-covering-letters.md; the demo's serif preview on
 * screen 08): paragraphs, line breaks, tables typed with | (amendment 3) and the table of travellers. A blank with a value
 * prints the value; one without shows as a chip, so Settings can show where each blank goes.
 */
export function LetterPaper({
  body,
  values,
  travellers,
}: {
  body: string
  /** What each blank prints. A blank left out shows as a chip. */
  values?: Readonly<Partial<Record<string, string>>>
  /** The rows {travellers} prints. Left out, it shows as a chip. */
  travellers?: readonly LetterTraveller[]
}) {
  const draw: DrawLine = (pieces) =>
    pieces.map((piece, k) =>
      'text' in piece ? (
        <Fragment key={k}>{piece.text}</Fragment>
      ) : values?.[piece.blank] !== undefined ? (
        <Fragment key={k}>{values[piece.blank]}</Fragment>
      ) : (
        <span key={k} className="letter-blank">{`{${piece.blank}}`}</span>
      ),
    )
  return <Paper blocks={letterBlocks(body)} draw={draw} travellers={travellers} />
}

/**
 * A case's letter as staff edit and make it (0019 amendments 1 and 3): its text, drawn as written, never read for
 * {blanks}. Lines with | between the columns are tables; a ⟦mark⟧ left where the case lacked a value shows as a chip.
 */
export function LetterTextPaper({ text }: { text: string }) {
  const draw: DrawLine = (pieces) =>
    pieces.map((piece, k) =>
      'text' in piece ? (
        <Fragment key={k}>{piece.text}</Fragment>
      ) : (
        <span key={k} className="letter-blank letter-mark">
          {piece.blank}
        </span>
      ),
    )
  return <Paper blocks={textBlocks(text)} draw={draw} />
}

function Paper({ blocks, draw, travellers }: { blocks: LetterBlock[]; draw: DrawLine; travellers?: readonly LetterTraveller[] }) {
  if (blocks.length === 0) {
    return (
      <div className="letter-paper">
        <p className="letter-empty">Nothing written yet.</p>
      </div>
    )
  }
  return (
    <div className="letter-paper">
      {blocks.map((block, i) =>
        block.kind === 'travellers' ? (
          <TravellersTable key={i} travellers={travellers} />
        ) : block.kind === 'table' ? (
          <LetterTable key={i} head={block.head} rows={block.rows} draw={draw} />
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {draw(line)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  )
}

/** A table typed with | between the columns: its first line as the headings, then its rows. */
function LetterTable({ head, rows, draw }: { head: LetterPiece[][]; rows: LetterPiece[][][]; draw: DrawLine }) {
  return (
    <table className="letter-table">
      <thead>
        <tr>
          {head.map((cell, c) => (
            <th key={c}>{draw(cell)}</th>
          ))}
        </tr>
      </thead>
      {rows.length > 0 && (
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((cell, c) => (
                <td key={c}>{draw(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </table>
  )
}

function TravellersTable({ travellers }: { travellers: readonly LetterTraveller[] | undefined }) {
  if (!travellers) {
    return (
      <div className="letter-table-blank">
        <span className="letter-blank">{'{travellers}'}</span> prints the table of travellers: name, relation, date of birth and
        passport no.
      </div>
    )
  }
  return (
    <table className="letter-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Relation</th>
          <th>Date of birth</th>
          <th>Passport no.</th>
        </tr>
      </thead>
      <tbody>
        {travellers.map((t, i) => (
          <tr key={i}>
            <td>{t.name}</td>
            <td>{t.relation}</td>
            <td>{t.dateOfBirth}</td>
            <td>{t.passportNo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
