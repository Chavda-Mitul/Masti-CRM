import { useRef, useState } from 'react'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { useRecordDecision, useUploadDecisionFile } from '../queries'
import type { VisaCase } from '../types'
import { DecisionRow } from './DecisionRow'
import { DECISION_FILE_ACCEPT, DECISION_FILE_LABEL, decisionFileKind, decisionFileProblem, type DecisionFileKind } from './decisionFiles'
import { emptyRow, numberWords, rowProblem, type DecisionRowValue } from './decisionValues'
import { fileSize } from './pdfFiles'

/**
 * "Record the decision" (docs/decisions/0012-visa-decision.md Decision 6): one form for the whole family once the file
 * was submitted. Each traveller is Approved or Refused (demo screen 11), with nothing typed (amended 23 Oct 2026, change
 * request 21): an approved one's sticker number (an e-visa's number) and dates are added later with Change on the
 * Decision card. Each traveller can also get their file, if staff have it (part 2): the refusal letter, the visa copy or
 * the e-visa, a PDF, JPG or PNG, each sent to the client on WhatsApp (part 3). Saving moves the case to Step 6 ·
 * Decision, then uploads the files one at a time: the server needs the outcome first, and the decision's own message
 * goes before them. The last approved traveller's e-visa finishes an e-visa case.
 */
export function DecisionDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const record = useRecordDecision(c.caseNo)
  const upload = useUploadDecisionFile(c.caseNo)
  // An e-visa where everyone is refused and we hold no passports closes the case (0025, part 5): check, then save.
  const guard = useWarningGuard()
  const online = !!c.submittedOnline
  const [rows, setRows] = useState<Record<string, DecisionRowValue>>(() => Object.fromEntries(c.travellers.map((t) => [t.id, emptyRow])))
  // Each traveller's file, picked here and uploaded once the decision is saved.
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const clearError = (id: string) => {
    if (errors[id]) setErrors(Object.fromEntries(Object.entries(errors).filter(([key]) => key !== id)))
  }
  const setRow = (id: string, patch: Partial<DecisionRowValue>) => {
    setRows({ ...rows, [id]: { ...rows[id]!, ...patch } })
    // Another outcome needs another file (a refusal letter, not a visa copy): the one picked goes.
    if (patch.outcome && patch.outcome !== rows[id]!.outcome && files[id]) setFiles({ ...files, [id]: null })
    // The row's message goes once it's touched; Save checks it again.
    clearError(id)
  }
  const pickFile = (id: string, picked: File | null) => {
    const problem = picked && decisionFileProblem(picked, c.decisionFileMaxMb)
    if (problem) {
      setErrors({ ...errors, [id]: problem })
      return
    }
    setFiles({ ...files, [id]: picked })
    clearError(id)
  }

  const press = () => {
    const missing: Record<string, string> = {}
    for (const t of c.travellers) {
      const problem = rowProblem(rows[t.id]!)
      if (problem) missing[t.id] = problem
    }
    setErrors(missing)
    if (Object.keys(missing).length) return
    const outcomes = c.travellers.map((t) => ({ travellerId: t.id, outcome: rows[t.id]!.outcome! }))
    const approved = outcomes.filter((o) => o.outcome === 'APPROVED').length
    const picked = c.travellers.flatMap((t) => {
      const file = files[t.id]
      return file ? [{ travellerId: t.id, name: t.name ?? t.label, kind: decisionFileKind(rows[t.id]!.outcome!, online), file }] : []
    })
    const save = async (confirmWarnings: boolean) => {
      let saved: VisaCase
      try {
        saved = await record.mutateAsync({ outcomes, updatedAt: c.updatedAt, ...(confirmWarnings ? { confirmWarnings } : {}) })
      } catch (err) {
        guard.intercept(err, () => void save(true))
        return
      }
      // An e-visa with everyone refused and no passports held has nothing left to do (0025, part 5).
      const recorded = `Decision recorded: ${approved} approved, ${outcomes.length - approved} refused.${saved.status === 'CLOSED' ? ' The case is closed.' : ''}`
      onClose()
      if (picked.length === 0) {
        toast({ tone: 'ok', message: recorded })
        return
      }
      toast({ tone: 'info', message: `${recorded} Sending ${picked.length === 1 ? 'the file' : `${picked.length} files`} to the client…` })
      // One at a time. The dialog has gone by now (the case is at Decision), but each upload still updates the case.
      const failed: string[] = []
      let latest = saved
      for (const p of picked) {
        try {
          latest = await upload.mutateAsync({ travellerId: p.travellerId, kind: p.kind, file: p.file })
        } catch (err) {
          const why = errorText(err)
          failed.push(`${p.name}’s ${DECISION_FILE_LABEL[p.kind].toLowerCase()}${why ? ` (${why})` : ''}`)
        }
      }
      // The last approved traveller's e-visa finishes the case: closed, or the passports we hold go back next.
      const finished = !saved.evisaSent && latest.evisaSent
      const next = !finished ? '' : latest.status === 'CLOSED' ? ' The case is delivered and closed.' : ' Every e-visa has gone: hand back the passports next.'
      if (failed.length === 0) {
        toast({ tone: 'ok', message: `${picked.length === 1 ? 'File sent' : `${picked.length} files sent`} to the client.${next}` })
      } else {
        toast({ tone: 'warn', message: `Not sent: ${failed.join('; ')}. Add ${failed.length === 1 ? 'it' : 'them'} on the Decision card.${next}` })
      }
    }
    void save(false)
  }
  const issue = errorBody(record.error)?.issues?.outcomes?.[0]
  const message = issue ?? errorText(record.error)

  return (
    <>
      <div className="overlay overlay-center" onClick={onClose}>
        <div className="dialog decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title" onClick={(e) => e.stopPropagation()}>
          <h2 className="h2" id="decision-title">
            Record the decision
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Approved or Refused, per traveller. Saving moves the case to Decision. The {numberWords(online)} and dates can be added later on the
            Decision card. If you have it, add each traveller’s refusal letter or {online ? 'e-visa' : 'visa copy'}: a PDF, JPG or PNG up to{' '}
            {c.decisionFileMaxMb} MB. Each file goes to the client on WhatsApp; it can also be added later on the card.
            {online && ' Once every approved traveller’s e-visa has gone, the case closes, or waits for the passports we hold to go back.'}
          </p>

          {c.travellers.map((t) => {
            const name = t.name ?? t.label
            const outcome = rows[t.id]!.outcome
            return (
              <DecisionRow
                key={t.id}
                name={name}
                row={rows[t.id]!}
                online={online}
                details={false}
                disabled={record.isPending}
                error={errors[t.id]}
                onChange={(patch) => setRow(t.id, patch)}
              >
                {outcome && (
                  <FilePick
                    kind={decisionFileKind(outcome, online)}
                    name={name}
                    file={files[t.id] ?? null}
                    disabled={record.isPending}
                    onPick={(picked) => pickFile(t.id, picked)}
                  />
                )}
              </DecisionRow>
            )
          })}

          {message && <div className="alert alert-bad">{message}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={record.isPending} onClick={press}>
              {record.isPending ? 'Saving…' : 'Save the decision'}
            </button>
          </div>
        </div>
      </div>
      {guard.modal}
    </>
  )
}

/** One traveller's optional file in the dialog: picked here, uploaded once the decision is saved. */
function FilePick({
  kind,
  name,
  file,
  disabled,
  onPick,
}: {
  kind: DecisionFileKind
  name: string
  file: File | null
  disabled: boolean
  onPick: (file: File | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const label = DECISION_FILE_LABEL[kind]
  return (
    <div className="decision-file">
      <span className="lbl">{label} (optional)</span>
      {kind === 'VISA_COPY' && <span className="hint">The passport’s visa page, or the approval letter.</span>}
      {file && (
        <span className="small">
          <strong>{file.name}</strong> · {fileSize(file.size)}
        </span>
      )}
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => input.current?.click()}>
        {file ? 'Pick another' : 'Pick file'}
      </button>
      {file && (
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => onPick(null)}>
          Remove
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={DECISION_FILE_ACCEPT}
        hidden
        aria-label={`${label} for ${name}`}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = '' // picking the same file again still triggers a change
          if (picked) onPick(picked)
        }}
      />
    </div>
  )
}
