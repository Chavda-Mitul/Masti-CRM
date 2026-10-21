import { Fragment } from 'react'
import { letterBlocks, textBlocks, type LetterPiece, type LetterTable, type LetterText } from '../lib/letter'
import '../styles/letter.css'

/** One row of the letter's table of travellers. */
export interface LetterTraveller {
  name: string
  relation: string
  dateOfBirth: string
  passportNo: string
}

/**
 * A covering letter drawn like the page it prints on (docs/decisions/0019-covering-letters.md; the demo's serif preview on
 * screen 08): paragraphs, line breaks and the table of travellers. A blank with a value prints the value; one without
 * shows as a chip, so Settings can show where each blank goes.
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
  const blocks = letterBlocks(body)
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
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {line.map((piece, k) =>
                  'text' in piece ? (
                    <Fragment key={k}>{piece.text}</Fragment>
                  ) : values?.[piece.blank] !== undefined ? (
                    <Fragment key={k}>{values[piece.blank]}</Fragment>
                  ) : (
                    <span key={k} className="letter-blank">{`{${piece.blank}}`}</span>
                  ),
                )}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
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

/**
 * A case's letter as staff edit and make it (0019 amendment 1): its text above the table, the table, the text below.
 * The text is drawn as written, never read for {blanks}; a ⟦mark⟧ left where the case lacked a value shows as a chip.
 */
export function LetterTextPaper({ letter }: { letter: LetterText }) {
  const top = textBlocks(letter.top)
  const bottom = textBlocks(letter.bottom)
  if (top.length === 0 && bottom.length === 0 && !letter.table) {
    return (
      <div className="letter-paper">
        <p className="letter-empty">Nothing written yet.</p>
      </div>
    )
  }
  return (
    <div className="letter-paper">
      <TextParagraphs paragraphs={top} />
      {letter.table && <LetterTableView table={letter.table} />}
      <TextParagraphs paragraphs={bottom} />
    </div>
  )
}

function TextParagraphs({ paragraphs }: { paragraphs: LetterPiece[][][] }) {
  return paragraphs.map((lines, i) => (
    <p key={i}>
      {lines.map((line, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          <Pieces line={line} />
        </Fragment>
      ))}
    </p>
  ))
}

function Pieces({ line }: { line: LetterPiece[] }) {
  return line.map((piece, k) =>
    'text' in piece ? (
      <Fragment key={k}>{piece.text}</Fragment>
    ) : (
      <span key={k} className="letter-blank letter-mark">
        {piece.blank}
      </span>
    ),
  )
}

/** The table as staff left it: their headings, rows and columns. */
function LetterTableView({ table }: { table: LetterTable }) {
  const cell = (text: string) => <Pieces line={textBlocks(text)[0]?.[0] ?? []} />
  return (
    <table className="letter-table">
      <thead>
        <tr>
          {table.columns.map((heading, c) => (
            <th key={c}>{cell(heading)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((text, c) => (
              <td key={c}>{cell(text)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
