// A covering letter split into what the page draws (docs/decisions/0019-covering-letters.md, amendments 3 and 5):
// paragraphs of lines, and tables typed as lines with | between the columns. components/LetterPaper.tsx draws both kinds
// of letter: a wording in Settings (letterBlocks: its {blanks} are pieces, and {travellers} the table of travellers) and
// a case's letter (textBlocks: plain text, where a ⟦mark⟧ and a [[note]] to the AI are the only pieces). Kept out of the
// component file so fast refresh keeps working. It imports nothing, so Backend/tests can load it.

export type LetterPiece = { text: string } | { blank: string } | { note: string }

export type LetterBlock =
  | { kind: 'paragraph'; lines: LetterPiece[][] }
  /** A table typed with | between the columns: its headings, then its rows, each cell a line of pieces. */
  | { kind: 'table'; head: LetterPiece[][]; rows: LetterPiece[][][] }
  /** {travellers} in a wording: the table of travellers the case fills in. */
  | { kind: 'travellers' }

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
// Tables (amendment 3): two or more lines in a row that each hold a | make a table, and its first line is the headings.
// ---------------------------------------------------------------------------------------------------------------------

/** A note to the AI (amendment 5): [[…]] on one line. As Backend/src/modules/coveringLetters/coveringLetters.schemas.ts. */
export const NOTE = /\[\[[^\n]*?\]\]/g

/**
 * A line of a table: it holds a | outside any note (amendments 3 and 5), so a note never makes a line a table. The
 * backend's isTableLine is the same rule, which Backend/tests/frontendRules.test.ts keeps alike.
 */
export function isTableLine(line: string): boolean {
  return line.replace(NOTE, '').includes('|')
}

/** A table's line split at each | outside a note, so a note in a cell is never cut. */
function splitCells(line: string): string[] {
  const notes = [...line.matchAll(NOTE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const)
  const cells: string[] = []
  let start = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '|' || notes.some(([from, to]) => i >= from && i < to)) continue
    cells.push(line.slice(start, i).trim())
    start = i + 1
  }
  cells.push(line.slice(start).trim())
  return cells
}

/** The line under a Markdown table's headings: every cell dashes, perhaps with a colon at either end (`:---:`). */
const isRuleLine = (cells: string[]) => cells.every((cell) => /^:?-+:?$/.test(cell))

/**
 * The cells of a table's lines, split at each | and trimmed. A | at the start or the end of the lines goes only when
 * every line has one (a Markdown table), so a row whose first cell was cleared doesn't shift left. The line of dashes
 * under Markdown headings goes, and every row is as wide as the widest, so typed text is never dropped. [] when nothing
 * but dashes is left.
 */
export function tableCells(lines: string[]): string[][] {
  const trimmed = lines.map((line) => line.trim())
  const lead = trimmed.every((line) => line.startsWith('|'))
  const trail = trimmed.every((line) => line.endsWith('|'))
  const rows = trimmed
    .map((line) => (lead ? line.slice(1) : line))
    .map((line) => (trail ? line.slice(0, -1) : line))
    .map(splitCells)
    .filter((cells) => !isRuleLine(cells))
  if (rows.length === 0) return []
  const width = Math.max(...rows.map((cells) => cells.length))
  return rows.map((cells) => [...cells, ...Array<string>(width - cells.length).fill('')])
}

/**
 * Text split into paragraphs and tables: a blank line starts a new paragraph and a single line break stays inside one;
 * two or more lines in a row that each hold a | make a table, while one such line alone stays text. `pieces` turns a
 * line or a cell into what's drawn; `own` gives a line a block of its own ({travellers} in a wording).
 */
function splitBlocks(text: string, pieces: (line: string) => LetterPiece[], own?: (line: string) => LetterBlock | null): LetterBlock[] {
  const blocks: LetterBlock[] = []
  let lines: LetterPiece[][] = []
  const endParagraph = () => {
    if (lines.length > 0) blocks.push({ kind: 'paragraph', lines })
    lines = []
  }
  const all = text.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!
    const block = own?.(line)
    if (block) {
      endParagraph()
      blocks.push(block)
      continue
    }
    if (line.trim() === '') {
      endParagraph()
      continue
    }
    if (isTableLine(line) && isTableLine(all[i + 1] ?? '')) {
      let end = i + 1
      while (end < all.length && isTableLine(all[end]!)) end++
      const [head, ...rows] = tableCells(all.slice(i, end))
      if (head) {
        endParagraph()
        blocks.push({ kind: 'table', head: head.map(pieces), rows: rows.map((cells) => cells.map(pieces)) })
        i = end - 1
        continue
      }
    }
    lines.push(pieces(line))
  }
  endParagraph()
  return blocks
}

/**
 * A table pasted from a page (ChatGPT's answer, Excel, Word) as | lines: those come as lines with tabs between the
 * cells. A | in a cell becomes a /, as in the CRM's own values. Null unless two or more lines hold a tab, so other text
 * pastes as it is.
 */
export function tabsToPipes(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.filter((line) => line.includes('\t')).length < 2) return null
  return lines
    .map((line) => (line.includes('\t') ? line.split('\t').map((cell) => cell.trim().replaceAll('|', '/')).join(' | ') : line))
    .join('\n')
}

// ---------------------------------------------------------------------------------------------------------------------
// A case's letter as staff edit it and make it (0019 amendments 1, 3 and 5): one text, not a wording plus values. The
// marks, the notes and the limit repeat Backend/src/modules/coveringLetters/coveringLetters.schemas.ts;
// Backend/tests/frontendRules.test.ts keeps the two the same, and Backend/tests/letterText.test.ts checks the tables.
// ---------------------------------------------------------------------------------------------------------------------

/** Where the case lacked a value, the draft writes ⟦the hotel stay⟧; "Make the letter" waits while any ⟦ or ⟧ is left. */
export const MARK_OPEN = '⟦'
export const MARK_CLOSE = '⟧'
/** Where {purpose} is in a draft: the paragraph on why they travel, which the AI or staff write (0019 amendments 2, 4). */
export const PURPOSE_MARK = '⟦why they travel⟧'

/** The longest letter a case keeps. */
export const MAX_CASE_LETTER_CHARS = 60000

/** The marks still in a letter, in plain words and in order, each once. A ⟦ or ⟧ left on its own counts too. */
export function marksIn(letter: string): string[] {
  const found = new Set<string>()
  for (const [, words] of letter.matchAll(/⟦([^⟦⟧\n]*)⟧|[⟦⟧]/g)) found.add(words?.trim() || 'a ⟦ or ⟧ left over')
  return [...found]
}

/** What `notesIn` lists for a [[ or ]] on its own, an empty [[ ]], or a note split over two lines. */
export const STRAY_NOTE = 'a [[ or ]] left over'

/** The notes to the AI still in a letter, exactly as written, brackets included, in order and each once; then STRAY_NOTE. */
export function notesIn(letter: string): string[] {
  const found = new Set<string>()
  let stray = false
  for (const line of letter.split('\n')) {
    const rest = line.replace(NOTE, (note) => {
      if (note.slice(2, -2).trim()) found.add(note)
      else stray = true
      return ''
    })
    if (rest.includes('[[') || rest.includes(']]')) stray = true
  }
  return stray ? [...found, STRAY_NOTE] : [...found]
}

/**
 * A line of a letter's text: its words, each ⟦mark⟧ as a blank and each [[note]] as a note, to show as chips. One
 * pattern finds both, so a mark inside a note stays part of the note.
 */
function markPieces(line: string): LetterPiece[] {
  const pieces: LetterPiece[] = []
  let at = 0
  for (const match of line.matchAll(/\[\[[^\n]*?\]\]|⟦[^⟦⟧\n]*⟧/g)) {
    const start = match.index ?? 0
    if (start > at) pieces.push({ text: line.slice(at, start) })
    pieces.push(match[0].startsWith('[[') ? { note: match[0] } : { blank: match[0] })
    at = start + match[0].length
  }
  if (at < line.length) pieces.push({ text: line.slice(at) })
  return pieces
}

/** A case's letter, drawn as written: its paragraphs and its | tables, with no {blanks}; marks and notes are the pieces. */
export function textBlocks(text: string): LetterBlock[] {
  return splitBlocks(text, markPieces)
}

/** A wording, for Settings: its paragraphs and | tables with their {blanks}, and {travellers} alone on a line. */
export function letterBlocks(body: string): LetterBlock[] {
  return splitBlocks(body, piecesOf, (line) => (TRAVELLERS_LINE.test(line) ? { kind: 'travellers' } : null))
}
