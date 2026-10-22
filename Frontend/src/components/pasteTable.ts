import type { ClipboardEvent } from 'react'
import { tabsToPipes } from '../lib/letter'

/**
 * A letter's text box, on paste: a table copied from a page (ChatGPT's answer, Excel, Word) comes in as lines with | between
 * the columns, which the letter draws as a table (docs/decisions/0019-covering-letters.md amendment 3). Anything else
 * pastes as usual. `onChange` gets the box's new text.
 */
export function pasteTable(onChange: (text: string) => void) {
  return (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const table = tabsToPipes(e.clipboardData.getData('text/plain'))
    if (table === null) return
    e.preventDefault()
    const box = e.currentTarget
    // insertText keeps the browser's undo and fires the box's change; setRangeText is for a browser without it.
    if (!document.execCommand('insertText', false, table)) {
      box.setRangeText(table, box.selectionStart, box.selectionEnd, 'end')
      onChange(box.value)
    }
  }
}
