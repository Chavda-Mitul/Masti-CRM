import { useRef } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useOpenCaseFile, useUploadFinalFile } from '../queries'
import type { VisaCase } from '../types'

const MB = 1024 * 1024

/** "12.4 MB", "820 KB" */
function fileSize(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

/**
 * "Saved file — kept as proof" (demo screen 08 ⚠️, docs/decisions/0007-visa-file-prep.md Decision 8): the whole file as
 * it went to the vendor, one PDF, in the private document store. The processor, the HOD or the Head uploads it during
 * File preparation; a newer upload becomes the current one and older ones are kept. Anyone who can open the case can
 * open the file, through a link that works for a few minutes.
 */
export function SavedFileCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const upload = useUploadFinalFile(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const input = useRef<HTMLInputElement>(null)
  if (!c.maturedAt) return null

  const canUpload =
    !!me && c.status === 'OPEN' && c.stage.code === 'FILE_PREPARATION' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const file = c.finalFile
  const older = c.finalFileCopies - 1

  const send = (picked: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again still triggers a change
    if (!picked) return
    if (!isPdf(picked)) {
      toast({ tone: 'bad', message: `${picked.name} isn’t a PDF. Save the scan as a PDF and upload that.` })
      return
    }
    if (picked.size > c.finalFileMaxMb * MB) {
      toast({ tone: 'bad', message: `${picked.name} is ${fileSize(picked.size)}: the limit is ${c.finalFileMaxMb} MB. Scan it at a lower resolution.` })
      return
    }
    upload.mutate(
      { file: picked },
      {
        onSuccess: () => toast({ tone: 'ok', message: file ? 'New copy saved. The earlier one is kept.' : 'File saved.' }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t upload the file. Please try again.' }),
      },
    )
  }

  return (
    <section className="card pad saved-file">
      <h2 className="h2">Saved file — kept as proof</h2>
      {file ? (
        <>
          <div className="kv">
            <span className="mono saved-file-name">{file.fileName}</span>
            <strong>
              {file.pageCount} {file.pageCount === 1 ? 'page' : 'pages'}
            </strong>
          </div>
          <p className="muted small saved-file-meta">
            {fileSize(file.sizeBytes)} · uploaded by {file.uploadedBy.name}, {formatDateTime(file.uploadedAt)}
            {older > 0 && ` · ${older} earlier ${older === 1 ? 'copy' : 'copies'} kept`}
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            Every page as it went to the vendor, stored privately. Open gives a link that works for a few minutes.
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {canUpload
            ? 'Scan the whole file as one PDF, every page as it goes to the vendor, and upload it here. It is stored privately.'
            : 'No file uploaded yet.'}
        </p>
      )}

      <div className="saved-file-actions">
        {file && (
          <button type="button" className="btn btn-sm" onClick={() => open(file.id)}>
            Open
          </button>
        )}
        {canUpload && (
          <>
            <button type="button" className={`btn btn-sm${file ? '' : ' btn-primary'}`} disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? 'Uploading…' : file ? 'Replace' : 'Upload PDF'}
            </button>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              aria-label="PDF of the final file"
              onChange={(e) => send(e.target.files?.[0])}
            />
            <span className="muted small">PDF, up to {c.finalFileMaxMb} MB</span>
          </>
        )}
      </div>
    </section>
  )
}
