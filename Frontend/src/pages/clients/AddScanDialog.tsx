import { useRef, useState, type FormEvent } from 'react'
import { FormField, RequiredMark } from '../../components/FormField'
import { useToast } from '../../lib/toast'
import { fileSize } from '../enquiries/case/pdfFiles'
import { errorText } from './apiErrors'
import { useAddClientDocument } from './queries'
import { SCAN_ACCEPT, scanProblem, scanType } from './scanFiles'
import type { ClientDocuments, ClientProfile } from './types'

/** The "whose paper" choice for a paper that's the client's own (a company's PAN card), not one person's. */
const OWN = 'own'

interface Problems {
  whose: string | null
  paper: string | null
  file: string | null
}

/**
 * "Add a scan" (docs/decisions/0016-client-documents.md): whose paper it is, which paper, and the file, a scanner's PDF
 * or a phone photo. It goes straight into the client's vault; a newer scan of the same paper becomes the current one.
 */
export function AddScanDialog({ client, vault, onClose }: { client: ClientProfile; vault: ClientDocuments; onClose: () => void }) {
  const add = useAddClientDocument(client.id)
  const toast = useToast()
  const picker = useRef<HTMLInputElement>(null)
  const [whose, setWhose] = useState(client.members.length === 1 ? (client.members[0]?.id ?? '') : '')
  const [paperId, setPaperId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<Problems>({ whose: null, paper: null, file: null })

  const pick = (picked: File | undefined) => {
    if (!picked) return
    setFile(picked)
    setProblems((p) => ({ ...p, file: scanProblem(picked, vault.maxMb) }))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const found: Problems = {
      whose: whose ? null : 'Pick whose paper this is.',
      paper: paperId ? null : 'Pick the paper.',
      file: file ? scanProblem(file, vault.maxMb) : 'Pick the file.',
    }
    setProblems(found)
    const type = file && scanType(file)
    if (found.whose || found.paper || found.file || !file || !type) return

    const owner = client.members.find((m) => m.id === whose)?.name ?? client.name
    const paper = vault.papers.find((p) => String(p.id) === paperId)?.name ?? 'scan'
    add.mutate(
      { documentId: Number(paperId), memberId: whose === OWN ? null : whose, file, type },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `Saved ${owner}’s ${paper}.` })
          onClose()
        },
      },
    )
  }

  const serverMessage = errorText(add.error)
  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-scan-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        noValidate
      >
        <h2 className="h2" id="add-scan-title">
          Add a scan
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Kept on {client.name}’s file for every later trip. Older scans of the same paper stay too.
        </p>

        <FormField label="Whose paper" required error={problems.whose ?? undefined}>
          <select
            className="select"
            value={whose}
            onChange={(e) => {
              setWhose(e.target.value)
              setProblems((p) => ({ ...p, whose: null }))
            }}
            autoFocus
          >
            <option value="">Pick…</option>
            {client.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.relation && ` · ${m.relation.name}`}
              </option>
            ))}
            <option value={OWN}>Not one person’s: the client’s own paper</option>
          </select>
        </FormField>

        <FormField label="Paper" required error={problems.paper ?? undefined}>
          <select
            className="select"
            value={paperId}
            onChange={(e) => {
              setPaperId(e.target.value)
              setProblems((p) => ({ ...p, paper: null }))
            }}
          >
            <option value="">Pick…</option>
            {vault.papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>

        <div className={`field${problems.file ? ' field-invalid' : ''}`}>
          <span>
            File
            <RequiredMark />
          </span>
          <div className="doc-file">
            <button type="button" className="btn btn-sm" onClick={() => picker.current?.click()}>
              {file ? 'Pick another file' : 'Pick the file'}
            </button>
            {file && (
              <span className="small">
                {file.name} · {fileSize(file.size)}
              </span>
            )}
          </div>
          <input
            ref={picker}
            type="file"
            hidden
            accept={SCAN_ACCEPT}
            onChange={(e) => {
              pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {problems.file ? (
            <span className="field-error" role="alert">
              {problems.file}
            </span>
          ) : (
            <span className="hint">A PDF, JPEG or PNG, up to {vault.maxMb} MB.</span>
          )}
        </div>

        {serverMessage && <div className="alert alert-bad">{serverMessage}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Save the scan'}
          </button>
        </div>
      </form>
    </div>
  )
}
