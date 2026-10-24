import { useEffect, useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { COMBINING_FOR_MS, combiningScans, combiningSince, useCombineScans, useOpenCaseFile } from '../queries'
import type { CombinedScans, VisaCase } from '../types'

/** "2 missing — Rakesh Mehta: Bank statement; Aarav Mehta: Passport" */
function missingText(missing: CombinedScans['missing']) {
  const count = missing.reduce((n, m) => n + m.papers.length, 0)
  return `${count} missing — ${missing.map((m) => `${m.traveller}: ${m.papers.join(', ')}`).join('; ')}`
}

/** Renders again at `at` (ms since 1970), once: when the "Combining…" minute is up, the button takes its place. */
function useRenderAgainAt(at: number | null) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (at === null) return
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, at - Date.now()))
    return () => clearTimeout(timer)
  }, [at])
}

/**
 * The case's scans combined into its saved file (docs/decisions/0008-visa-docket-dispatch.md Amendment 1): in the Saved
 * file card during file preparation (`inSavedFile`), and on the Docket and Submit online cards at Docket & dispatch.
 * "Mark documents complete" (and "File ready" again) combines them on its own when every paper that came in has a scan,
 * the person's newest on file; the combined PDF becomes the newest saved file. This line shows the file, with Open (the
 * Saved file card shows it itself); or whose scans are missing, when nothing was combined; and "Combine again", for
 * whoever can act on the case, once they're all there. Uploading a PDF by hand works as before.
 */
export function CombinedScansLine({ visaCase: c, inSavedFile = false }: { visaCase: VisaCase; inSavedFile?: boolean }) {
  const { data: me } = useMe()
  const toast = useToast()
  const combine = useCombineScans(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const combining = combiningScans(c)
  const since = combiningSince(c)
  useRenderAgainAt(combining && since ? Date.parse(since) + COMBINING_FOR_MS : null)
  const s = c.combinedScans
  if (!s) return null

  if (s.file) {
    const file = s.file
    const scans = `${file.scanCount} ${file.scanCount === 1 ? 'scan' : 'scans'}`
    // The Saved file card shows the file itself: just say where it came from, unless an upload replaced it since.
    if (inSavedFile && c.finalFile?.id === file.id) return <p className="muted small combined-scans-note">Made from the {scans} on file.</p>
    return (
      <div className="combined-scans">
        <p className="small">
          <strong>Scans combined into the saved file</strong> · {scans}, {file.pageCount}{' '}
          {file.pageCount === 1 ? 'page' : 'pages'} · {formatDateTime(file.at)}
        </p>
        <button type="button" className="btn btn-sm" onClick={() => open(file.id)}>
          Open
        </button>
      </div>
    )
  }
  if (s.needed === 0) return <p className="muted small combined-scans-note">No papers came in, so there are no scans to combine.</p>
  if (combining) return <p className="muted small combined-scans-note">Combining the scans into the saved file…</p>

  const canAct = !!me && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const pressCombine = () =>
    combine.mutate(undefined, {
      onSuccess: () => toast({ tone: 'ok', message: 'Scans combined into the saved file.' }),
      onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t combine the scans. Please try again.' }),
    })
  const button = canAct && (
    <button type="button" className="btn btn-sm" disabled={s.missing.length > 0 || combine.isPending} onClick={pressCombine}>
      {combine.isPending ? 'Combining…' : 'Combine again'}
    </button>
  )

  if (s.missing.length > 0) {
    return (
      <div className="combined-scans-missing">
        <div className="alert alert-warn">
          Scans not combined: {missingText(s.missing)}. An HOD can add a missing scan on the client page.
        </div>
        {button}
      </div>
    )
  }
  return (
    <div className="combined-scans">
      <p className="muted small">Scans not combined yet.</p>
      {button}
    </div>
  )
}
