import { useRef } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useOpenCaseFile, useUploadDecisionFile } from '../queries'
import type { CaseTraveller, VisaCase } from '../types'
import { DECISION_FILE_ACCEPT, decisionFileProblem } from './decisionFiles'

/**
 * An approved traveller's e-visa on the Decision card (docs/decisions/0025-evisa-after-decision.md): the PDF the portal
 * issued, or a photo of it kept as a PDF (change request 21, part 2), kept privately and opened through a link that
 * works for a few minutes. It goes to the client on WhatsApp as soon as it's uploaded (part 3: no check, no "Send the
 * e-visa"), and the last approved traveller's finishes the case. A newer upload becomes the current one and goes too;
 * older ones are kept. Uploaded by whoever can act on the case; anyone who can open the case sees it.
 */
export function EvisaLine({ visaCase: c, traveller: t, canAct }: { visaCase: VisaCase; traveller: CaseTraveller; canAct: boolean }) {
  const toast = useToast()
  const upload = useUploadDecisionFile(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const input = useRef<HTMLInputElement>(null)
  const evisa = t.evisa
  const older = evisa ? evisa.copies - 1 : 0
  const name = t.name ?? t.label

  const send = (picked: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again still triggers a change
    if (!picked) return
    const problem = decisionFileProblem(picked, c.decisionFileMaxMb)
    if (problem) {
      toast({ tone: 'bad', message: problem })
      return
    }
    upload.mutate(
      { travellerId: t.id, kind: 'EVISA', file: picked },
      {
        onSuccess: (saved) => {
          const sent = evisa ? 'New copy sent to the client. The earlier one is kept.' : 'E-visa sent to the client.'
          // The last approved traveller's e-visa finishes the case: closed, or the passports we hold go back next.
          const finished = !c.evisaSent && saved.evisaSent
          const next = !finished ? '' : saved.status === 'CLOSED' ? ' The case is delivered and closed.' : ' Every e-visa has gone: hand back the passports next.'
          toast({ tone: 'ok', message: sent + next })
        },
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t upload the e-visa. Please try again.' }),
      },
    )
  }

  return (
    <span className="evisa-line">
      {evisa ? (
        <>
          <span className="chip chip-info">e-Visa PDF</span>
          <span className="muted small">
            {evisa.pageCount} {evisa.pageCount === 1 ? 'page' : 'pages'} · {evisa.uploadedBy.name}, {formatDateTime(evisa.uploadedAt)}
            {older > 0 && ` · ${older} earlier ${older === 1 ? 'copy' : 'copies'} kept`}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => open(evisa.id)}>
            Open
          </button>
        </>
      ) : (
        <span className="muted small">No e-visa PDF yet</span>
      )}
      {canAct && (
        <>
          <button type="button" className="btn btn-sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : evisa ? 'Replace' : 'Upload e-visa'}
          </button>
          <input
            ref={input}
            type="file"
            accept={DECISION_FILE_ACCEPT}
            hidden
            aria-label={`E-visa for ${name}`}
            onChange={(e) => send(e.target.files?.[0])}
          />
        </>
      )}
    </span>
  )
}
