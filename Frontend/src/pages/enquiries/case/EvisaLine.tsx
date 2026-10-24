import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { enquiryKeys, useOpenCaseFile, useSetEvisaCheck, useUploadDecisionFile } from '../queries'
import type { CaseTraveller, StickerCheck, VisaCase } from '../types'
import { DECISION_FILE_ACCEPT, decisionFileProblem } from './decisionFiles'

/**
 * An approved traveller's e-visa on the Decision card (docs/decisions/0025-evisa-after-decision.md, part 1): the PDF the
 * portal issued, or a photo of it kept as a PDF (change request 21, part 2), kept privately and opened through a link
 * that works for a few minutes, then checked against the
 * passport and what was recorded at Step 6: Matches or Doesn't match. A newer upload becomes the current one, older ones
 * are kept, and the check is cleared: the new PDF needs a new look. Changed by whoever can act on the case, at Decision;
 * anyone who can open the case sees it.
 */
export function EvisaLine({ visaCase: c, traveller: t, canAct }: { visaCase: VisaCase; traveller: CaseTraveller; canAct: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const upload = useUploadDecisionFile(c.caseNo)
  const setCheck = useSetEvisaCheck(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const input = useRef<HTMLInputElement>(null)
  const evisa = t.evisa
  const older = evisa ? evisa.copies - 1 : 0
  const name = t.name ?? t.label
  const busy = upload.isPending || setCheck.isPending

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
        onSuccess: () =>
          toast({ tone: 'ok', message: evisa ? 'New copy saved. The earlier one is kept. Check this one against the passport.' : 'E-visa saved. Now check it against the passport.' }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t upload the e-visa. Please try again.' }),
      },
    )
  }

  const pick = (check: StickerCheck) => {
    if (!evisa) return
    // Pressing the chosen one again undoes it, as with the processor's paper checks.
    setCheck.mutate(
      { travellerId: t.id, fileId: evisa.id, check: t.stickerCheck === check ? null : check },
      {
        onError: (err) => {
          // Someone may have uploaded a newer PDF: load it, so that's the one checked.
          void queryClient.invalidateQueries({ queryKey: enquiryKeys.case(c.caseNo) })
          toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save the check. Please try again.' })
        },
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
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
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
      {evisa &&
        (canAct ? (
          <span className="seg-btn" role="radiogroup" aria-label={`${name}: e-visa against the passport`}>
            <button
              type="button"
              role="radio"
              aria-checked={t.stickerCheck === 'MATCHES'}
              className={t.stickerCheck === 'MATCHES' ? 'on ok' : ''}
              disabled={busy}
              onClick={() => pick('MATCHES')}
            >
              Matches
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={t.stickerCheck === 'MISMATCH'}
              className={t.stickerCheck === 'MISMATCH' ? 'on bad' : ''}
              disabled={busy}
              onClick={() => pick('MISMATCH')}
            >
              Doesn’t match
            </button>
          </span>
        ) : (
          <span className={t.stickerCheck === 'MATCHES' ? 'chip chip-ok' : t.stickerCheck === 'MISMATCH' ? 'chip chip-bad' : 'muted small'}>
            {t.stickerCheck === 'MATCHES' ? 'Matches the passport' : t.stickerCheck === 'MISMATCH' ? 'Doesn’t match the passport' : 'Not checked yet'}
          </span>
        ))}
      {evisa && t.stickerCheck === 'MISMATCH' && (
        <span className="small evisa-mismatch">
          Doesn’t match: get it corrected on the portal and upload the new PDF, or fix our typing with Change.
        </span>
      )}
    </span>
  )
}
