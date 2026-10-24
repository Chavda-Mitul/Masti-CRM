import { useRef } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useOpenCaseFile, useUploadDecisionFile } from '../queries'
import type { CaseFile, CaseTraveller, VisaCase } from '../types'
import { DECISION_FILE_ACCEPT, decisionFileProblem } from './decisionFiles'

/** The two letters this line shows: a refused traveller's refusal letter, an approved paper visa's visa copy. */
type LetterKind = 'REFUSAL_LETTER' | 'VISA_COPY'

const WORDS: Record<LetterKind, { chip: string; none: string; upload: string; saved: string; failed: string }> = {
  REFUSAL_LETTER: {
    chip: 'Refusal letter',
    none: 'No refusal letter yet',
    upload: 'Upload letter',
    saved: 'Refusal letter saved.',
    failed: 'Couldn’t upload the letter. Please try again.',
  },
  VISA_COPY: {
    chip: 'Visa copy',
    none: 'No visa copy yet',
    upload: 'Upload visa copy',
    saved: 'Visa copy saved.',
    failed: 'Couldn’t upload the visa copy. Please try again.',
  },
}

/**
 * A traveller's letter on the Decision card (demo screen 11 ⚠️, docs/decisions/0012-visa-decision.md): a refused
 * traveller's refusal letter (Decision 4), or an approved paper visa's visa copy, the passport's visa page or the
 * approval letter (amended 24 Oct 2026, change request 21). A scanned PDF, or a photo kept as one, kept privately and
 * opened through a link that works for a few minutes. Optional, and uploaded any time once decided, whatever the case's
 * status (a letter often comes back inside the passport). A newer upload becomes the current one and older ones are
 * kept.
 */
export function TravellerFileLine({
  visaCase: c,
  traveller: t,
  kind,
  file,
  canUpload,
}: {
  visaCase: VisaCase
  traveller: CaseTraveller
  kind: LetterKind
  file: (CaseFile & { copies: number }) | null
  canUpload: boolean
}) {
  const toast = useToast()
  const upload = useUploadDecisionFile(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const input = useRef<HTMLInputElement>(null)
  const words = WORDS[kind]
  const older = file ? file.copies - 1 : 0

  const send = (picked: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again still triggers a change
    if (!picked) return
    const problem = decisionFileProblem(picked, c.decisionFileMaxMb)
    if (problem) {
      toast({ tone: 'bad', message: problem })
      return
    }
    upload.mutate(
      { travellerId: t.id, kind, file: picked },
      {
        onSuccess: () => toast({ tone: 'ok', message: file ? 'New copy saved. The earlier one is kept.' : words.saved }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? words.failed }),
      },
    )
  }

  return (
    <span className="traveller-file">
      {file ? (
        <>
          <span className="chip chip-info">{words.chip}</span>
          <span className="muted small">
            {file.pageCount} {file.pageCount === 1 ? 'page' : 'pages'} · {file.uploadedBy.name}, {formatDateTime(file.uploadedAt)}
            {older > 0 && ` · ${older} earlier ${older === 1 ? 'copy' : 'copies'} kept`}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => open(file.id)}>
            Open
          </button>
        </>
      ) : (
        <span className="muted small">{words.none}</span>
      )}
      {canUpload && (
        <>
          <button type="button" className="btn btn-sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : file ? 'Replace' : words.upload}
          </button>
          <input
            ref={input}
            type="file"
            accept={DECISION_FILE_ACCEPT}
            hidden
            aria-label={`${words.chip} for ${t.name ?? t.label}`}
            onChange={(e) => send(e.target.files?.[0])}
          />
        </>
      )}
    </span>
  )
}
