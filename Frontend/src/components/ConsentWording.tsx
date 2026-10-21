import { Fragment } from 'react'
import '../styles/letter.css'

/** The wording's paragraphs: a blank line starts a new one; a single line break stays inside it. */
function paragraphsOf(body: string): string[][] {
  const paragraphs: string[][] = []
  let lines: string[] = []
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() !== '') lines.push(line)
    else if (lines.length > 0) {
      paragraphs.push(lines)
      lines = []
    }
  }
  if (lines.length > 0) paragraphs.push(lines)
  return paragraphs
}

/**
 * The consent form's wording as the client reads it (docs/decisions/0022-consent-form.md), on the covering letter's
 * paper. Plain text: unlike a letter it has no blanks to fill, so braces show as typed.
 */
export function ConsentWording({ body }: { body: string }) {
  return (
    <div className="letter-paper">
      {paragraphsOf(body).map((lines, i) => (
        <p key={i}>
          {lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  )
}
