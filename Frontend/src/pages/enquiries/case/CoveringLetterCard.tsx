import { useState } from 'react'
import { Link } from 'react-router'
import { canActOnCase, canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { LetterPaper } from '../../../components/LetterPaper'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useCoveringLetter, useMakeCoveringLetter } from '../queries'
import type { CoveringLetterView, VisaCase } from '../types'

/**
 * "Covering letter" (demo screen 08 ⚠️, docs/decisions/0019-covering-letters.md Decisions 8–12), beside the saved file:
 * the letters that fit the case, one filled in from it, and Make the letter. The processor, the HOD or the Head make it
 * at File preparation, once nothing it needs is missing; after that anyone who can open the case prints the same letter.
 */
export function CoveringLetterCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  // Undefined: the server's pick (the letter made, else the first that fits).
  const [formatId, setFormatId] = useState<number | undefined>()
  const [whole, setWhole] = useState(false)
  const letter = useCoveringLetter(c.caseNo, formatId, !!c.maturedAt)
  if (!c.maturedAt) return null

  const editable =
    !!me && c.status === 'OPEN' && c.stage.code === 'FILE_PREPARATION' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const view = letter.data

  return (
    <section className="card pad covering-letter">
      <h2 className="h2">Covering letter</h2>
      {letter.isError ? (
        <div className="alert alert-bad">{errorText(letter.error)}</div>
      ) : !view ? (
        <p className="muted small" style={{ margin: 0 }}>
          Loading…
        </p>
      ) : editable ? (
        <LetterMaker caseNo={c.caseNo} view={view} onPick={setFormatId} onWhole={() => setWhole(true)} canAddLetters={!!me && canEditVisaMasters(me)} />
      ) : (
        <MadeLetter caseNo={c.caseNo} view={view} preparing={c.stage.code === 'FILE_PREPARATION'} />
      )}

      {whole && view?.selected && (
        <div className="overlay overlay-center" onClick={() => setWhole(false)}>
          <div className="dialog covering-letter-dialog" role="dialog" aria-modal="true" aria-label={view.selected.name} onClick={(e) => e.stopPropagation()}>
            <h2 className="h2">{view.selected.name}</h2>
            <LetterPaper body={view.selected.body} values={view.selected.values} travellers={view.selected.travellers} />
            <div className="covering-letter-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setWhole(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

const openPrint = (caseNo: string) => window.open(`/print/covering-letter/${encodeURIComponent(caseNo)}`, '_blank')

/** "Made by Neha Joshi · 19 Oct, 4:12 pm · Schengen · tourist · family" */
function madeLine(made: NonNullable<CoveringLetterView['made']>) {
  return `Made by ${made.madeBy?.name ?? '—'} · ${formatDateTime(made.madeAt)} · ${made.formatName}`
}

/** At File preparation, for the processor, the HOD and the Head: pick, check what's missing, make, print. */
function LetterMaker({
  caseNo,
  view,
  onPick,
  onWhole,
  canAddLetters,
}: {
  caseNo: string
  view: CoveringLetterView
  onPick: (formatId: number) => void
  onWhole: () => void
  canAddLetters: boolean
}) {
  const toast = useToast()
  const make = useMakeCoveringLetter(caseNo)
  const { selected, made, fits } = view

  if (!selected) {
    return (
      <>
        <p className="muted small" style={{ margin: 0 }}>
          No covering letter fits this case yet ({fits.visaType} · {fits.country} · {fits.travellers}{' '}
          {fits.travellers === 1 ? 'traveller' : 'travellers'}).
          {canAddLetters && (
            <>
              {' '}
              <Link to="/settings/masters/covering-letters">Add one in Settings</Link>.
            </>
          )}
        </p>
        {made && <MadeLetter caseNo={caseNo} view={view} preparing />}
      </>
    )
  }

  const onMake = () =>
    make.mutate(selected.formatId, {
      onSuccess: () => {
        onPick(selected.formatId)
        toast({ tone: 'ok', message: 'Letter made. Print it on the client’s letterhead.' })
      },
      onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t make the letter. Please try again.' }),
    })

  return (
    <>
      <select
        className="select"
        value={selected.formatId}
        onChange={(e) => onPick(Number(e.target.value))}
        aria-label="Covering letter"
        disabled={view.letters.length < 2}
      >
        {view.letters.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {selected.sample && <span className="chip chip-warn chip-sm covering-letter-sample">Sample wording: Masti’s own format isn’t in yet</span>}
      <div className="covering-letter-preview" aria-label="Preview">
        <LetterPaper body={selected.body} values={selected.values} travellers={selected.travellers} />
      </div>
      <button type="button" className="btn-link covering-letter-whole" onClick={onWhole}>
        See the whole letter
      </button>
      {selected.missing.length > 0 && (
        <div className="alert alert-warn covering-letter-missing" role="status">
          Still needed: {selected.missing.join('; ')}. Fill them in on this case or on the client’s family list.
        </div>
      )}
      {made && <p className="muted small covering-letter-made">{madeLine(made)}</p>}
      <div className="covering-letter-actions">
        <button type="button" className="btn btn-sm btn-dark" onClick={onMake} disabled={selected.missing.length > 0 || make.isPending}>
          {make.isPending ? 'Making…' : made ? 'Make it again' : 'Make the letter'}
        </button>
        {made && (
          <button type="button" className="btn btn-sm" onClick={() => openPrint(caseNo)}>
            Print
          </button>
        )}
      </div>
    </>
  )
}

/** Read-only: the letter made, to print again; or that none was made (yet, while the file is still being prepared). */
function MadeLetter({ caseNo, view, preparing }: { caseNo: string; view: CoveringLetterView; preparing: boolean }) {
  if (!view.made) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {preparing ? 'Not made yet.' : 'No covering letter was made.'}
      </p>
    )
  }
  return (
    <>
      <p className="muted small covering-letter-made">{madeLine(view.made)}</p>
      <div className="covering-letter-actions">
        <button type="button" className="btn btn-sm" onClick={() => openPrint(caseNo)}>
          Print
        </button>
      </div>
    </>
  )
}
