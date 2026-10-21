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

// ---------------------------------------------------------------------------------------------------------------------
// A case's letter as staff edit and make it (0019 amendment 1): its text, not a wording plus values. The marks and the
// limits repeat Backend/src/modules/coveringLetters/coveringLetters.schemas.ts; Backend/tests/frontendRules.test.ts
// keeps the two the same.
// ---------------------------------------------------------------------------------------------------------------------

/** Where the case lacked a value, the draft writes ⟦the hotel stay⟧; "Make the letter" waits while any ⟦ or ⟧ is left. */
export const MARK_OPEN = '⟦'
export const MARK_CLOSE = '⟧'
/** Where {purpose} is in a draft: the paragraph "Write it with AI" writes, or staff type (0019 amendment 2). */
export const PURPOSE_MARK = '⟦why they travel⟧'

export const MAX_LETTER_PART_CHARS = 8000
export const MAX_LETTER_COLUMNS = 6
export const MAX_LETTER_ROWS = 60
export const MAX_LETTER_HEADING_CHARS = 60
export const MAX_LETTER_CELL_CHARS = 200

export interface LetterTable {
  columns: string[]
  rows: string[][]
}

/** The text above the table, the table (where {travellers} was; null when the wording has none), the text below. */
export interface LetterText {
  top: string
  table: LetterTable | null
  bottom: string
}

/** The marks still in a letter, in plain words and in order, each once. A ⟦ or ⟧ left on its own counts too. */
export function marksIn(letter: LetterText): string[] {
  const parts = [letter.top, ...(letter.table ? [...letter.table.columns, ...letter.table.rows.flat()] : []), letter.bottom]
  const found = new Set<string>()
  for (const part of parts) {
    for (const [, words] of part.matchAll(/⟦([^⟦⟧\n]*)⟧|[⟦⟧]/g)) found.add(words?.trim() || 'a ⟦ or ⟧ left over')
  }
  return [...found]
}

/** Plain text, split like a wording (a blank line starts a paragraph) but with no {blanks}: a mark is the only piece. */
export function textBlocks(text: string): LetterPiece[][][] {
  const paragraphs: LetterPiece[][][] = []
  let lines: LetterPiece[][] = []
  const end = () => {
    if (lines.length > 0) paragraphs.push(lines)
    lines = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') end()
    else lines.push(markPieces(line))
  }
  end()
  return paragraphs
}

/** A line of a letter's text: its words, and each ⟦mark⟧ as a blank to show as a chip. */
function markPieces(line: string): LetterPiece[] {
  const pieces: LetterPiece[] = []
  let at = 0
  for (const match of line.matchAll(/⟦[^⟦⟧\n]*⟧/g)) {
    const start = match.index ?? 0
    if (start > at) pieces.push({ text: line.slice(at, start) })
    pieces.push({ blank: match[0] })
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
