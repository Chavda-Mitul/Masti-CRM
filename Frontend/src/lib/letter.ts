// A covering letter's wording, split into what the page draws (docs/decisions/0019-covering-letters.md): paragraphs of
// lines, each line made of text and {blanks}, and the table of travellers on its own. components/LetterPaper.tsx draws it,
// in Settings now and on the case's letter later. Kept out of the component file so fast refresh keeps working.

export type LetterPiece = { text: string } | { blank: string }

export type LetterBlock = { kind: 'paragraph'; lines: LetterPiece[][] } | { kind: 'travellers' }

const TRAVELLERS_LINE = /^[ \t]*\{travellers\}[ \t]*$/

function piecesOf(line: string): LetterPiece[] {
  const pieces: LetterPiece[] = []
  let at = 0
  for (const match of line.matchAll(/\{([^{}]*)\}/g)) {
    const start = match.index ?? 0
    if (start > at) pieces.push({ text: line.slice(at, start) })
    pieces.push({ blank: match[1]! })
    at = start + match[0].length
  }
  if (at < line.length) pieces.push({ text: line.slice(at) })
  return pieces
}

/** A blank line starts a new paragraph; a single line break stays inside one. {travellers} alone on a line is the table. */
export function letterBlocks(body: string): LetterBlock[] {
  const blocks: LetterBlock[] = []
  let lines: LetterPiece[][] = []
  const endParagraph = () => {
    if (lines.length > 0) blocks.push({ kind: 'paragraph', lines })
    lines = []
  }
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') endParagraph()
    else if (TRAVELLERS_LINE.test(line)) {
      endParagraph()
      blocks.push({ kind: 'travellers' })
    } else lines.push(piecesOf(line))
  }
  endParagraph()
  return blocks
}
