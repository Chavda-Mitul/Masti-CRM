import { useRef } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useOpenCaseFile, useUploadRefusalLetter } from '../queries'
import type { CaseTraveller, VisaCase } from '../types'
import { pdfProblem } from './pdfFiles'

/**
 * A refused traveller's refusal letter on the Decision card (demo screen 11 ⚠️, docs/decisions/0012-visa-decision.md
 * Decision 4): a scanned PDF kept privately, opened through a link that works for a few minutes. Optional, and
 * uploaded any time once the traveller is refused, whatever the case's status (it often comes back inside the
 * passport). A newer upload becomes the current one and older ones are kept.
 */
export function RefusalLetterLine({ visaCase: c, traveller: t, canUpload }: { visaCase: VisaCase; traveller: CaseTraveller; canUpload: boolean }) {
  const toast = useToast()
  const upload = useUploadRefusalLetter(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const input = useRef<HTMLInputElement>(null)
  const letter = t.refusalLetter
  const older = letter ? letter.copies - 1 : 0

  const send = (picked: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again still triggers a change
    if (!picked) return
    const problem = pdfProblem(picked, c.finalFileMaxMb)
    if (problem) {
      toast({ tone: 'bad', message: problem })
      return
    }
    upload.mutate(
      { travellerId: t.id, file: picked },
      {
        onSuccess: () => toast({ tone: 'ok', message: letter ? 'New copy saved. The earlier one is kept.' : 'Refusal letter saved.' }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t upload the letter. Please try again.' }),
      },
    )
  }

  return (
    <span className="refusal-letter">
      {letter ? (
        <>
          <span className="chip chip-info">Refusal letter</span>
          <span className="muted small">
            {letter.pageCount} {letter.pageCount === 1 ? 'page' : 'pages'} · {letter.uploadedBy.name}, {formatDateTime(letter.uploadedAt)}
            {older > 0 && ` · ${older} earlier ${older === 1 ? 'copy' : 'copies'} kept`}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => open(letter.id)}>
            Open
          </button>
        </>
      ) : (
        <span className="muted small">No refusal letter yet</span>
      )}
      {canUpload && (
        <>
          <button type="button" className="btn btn-sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : letter ? 'Replace' : 'Upload letter'}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            aria-label={`Refusal letter for ${t.name ?? t.label}`}
            onChange={(e) => send(e.target.files?.[0])}
          />
        </>
      )}
    </span>
  )
}
