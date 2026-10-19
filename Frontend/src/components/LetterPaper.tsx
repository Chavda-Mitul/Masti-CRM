import { Fragment } from 'react'
import { letterBlocks } from '../lib/letter'
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
        {travellers.map((t) => (
          <tr key={`${t.name}:${t.passportNo}`}>
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
