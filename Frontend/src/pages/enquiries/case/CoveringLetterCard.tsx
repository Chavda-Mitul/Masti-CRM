import { useState } from 'react'
import { Link } from 'react-router'
import { canActOnCase, canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { LetterTextPaper } from '../../../components/LetterPaper'
import { useLeaveGuard } from '../../../components/useLeaveGuard'
import { errorText, issueText } from '../../../lib/apiErrors'
import { formatDate, formatDateTime, istParts, istToday } from '../../../lib/format'
import { marksIn, type LetterText } from '../../../lib/letter'
import { useToast } from '../../../lib/toast'
import { useCoveringLetter, useMakeCoveringLetter } from '../queries'
import type { CoveringLetterView, VisaCase } from '../types'
import { CoveringLetterEditor } from './CoveringLetterEditor'

/**
 * "Covering letter" (demo screen 08 ⚠️, docs/decisions/0019-covering-letters.md Decisions 8–12, amendment 1), beside the
 * saved file: the letters that fit the case, one drafted from it, and Make the letter. At File preparation the
 * processor, the HOD or the Head may change any of its text, the table included, and type over the ⟦marks⟧ where the
 * case lacked a value; the letter is made with that text. After that anyone who can open the case prints the same letter.
 */
export function CoveringLetterCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  // Undefined: the server's pick (the letter made, else the first that fits).
  const [formatId, setFormatId] = useState<number | undefined>()
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
        <LetterMaker
          caseNo={c.caseNo}
          view={view}
          loading={letter.isPlaceholderData}
          onPick={setFormatId}
          canAddLetters={!!me && canEditVisaMasters(me)}
        />
      ) : (
        <MadeLetter caseNo={c.caseNo} view={view} preparing={c.stage.code === 'FILE_PREPARATION'} />
      )}
    </section>
  )
}

const openPrint = (caseNo: string) => window.open(`/print/covering-letter/${encodeURIComponent(caseNo)}`, '_blank')

/** "Made by Neha Joshi · 19 Oct, 4:12 pm · Schengen · tourist · family" */
function madeLine(made: NonNullable<CoveringLetterView['made']>) {
  return `Made by ${made.madeBy?.name ?? '—'} · ${formatDateTime(made.madeAt)} · ${made.formatName}`
}

/** At File preparation, for the processor, the HOD and the Head: pick a letter, or say none fits yet. */
function LetterMaker({
  caseNo,
  view,
  loading,
  onPick,
  canAddLetters,
}: {
  caseNo: string
  view: CoveringLetterView
  /** Another letter was picked and is still loading: the one shown is the last. */
  loading: boolean
  onPick: (formatId: number) => void
  canAddLetters: boolean
}) {
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
  // A letter picked starts from scratch: edits belong to the letter they were made in.
  return <LetterDesk key={selected.formatId} caseNo={caseNo} view={view} selected={selected} loading={loading} onPick={onPick} />
}

type Asking = { kind: 'pick'; formatId: number } | { kind: 'restart' } | null

/**
 * One letter on the desk: drawn from the letter made when it's this one, else from today's draft; changed in "Edit the
 * letter"; made with its text. The edits stay here until Make the letter: leaving, reloading, picking another letter or
 * starting again asks first.
 */
function LetterDesk({
  caseNo,
  view,
  selected,
  loading,
  onPick,
}: {
  caseNo: string
  view: CoveringLetterView
  selected: NonNullable<CoveringLetterView['selected']>
  loading: boolean
  onPick: (formatId: number) => void
}) {
  const toast = useToast()
  const make = useMakeCoveringLetter(caseNo)
  // Nothing is copied from the server into state: until someone edits, the card draws the server's letter, so a trip
  // saved on the case shows at once.
  const [edited, setEdited] = useState<LetterText | null>(null)
  // "Start again": today's draft even though a letter was made.
  const [fresh, setFresh] = useState(false)
  const [editing, setEditing] = useState(false)
  const [whole, setWhole] = useState(false)
  const [asking, setAsking] = useState<Asking>(null)

  const { made } = view
  const fromMade = !fresh && made?.formatId === selected.formatId ? made : null
  const versionId = fromMade ? fromMade.versionId : selected.versionId
  const letter = edited ?? (fromMade ? fromMade.letter : selected.draft)
  const dirty = edited !== null
  const marks = marksIn(letter)
  const madeDay = fromMade ? istParts(fromMade.madeAt).date : null
  const busy = loading || make.isPending

  const pick = (id: number) => (dirty ? setAsking({ kind: 'pick', formatId: id }) : onPick(id))
  const restart = () => (dirty ? setAsking({ kind: 'restart' }) : setFresh(true))
  const discard = () => {
    const was = asking
    setAsking(null)
    setEdited(null)
    if (was?.kind === 'pick') onPick(was.formatId)
    else setFresh(true)
  }

  const onMake = () =>
    make.mutate(
      { formatId: selected.formatId, versionId, letter },
      {
        onSuccess: () => {
          setEdited(null)
          setFresh(false)
          onPick(selected.formatId)
          toast({ tone: 'ok', message: 'Letter made. Print it on the client’s letterhead.' })
        },
        onError: (err) => toast({ tone: 'bad', message: issueText(err) ?? 'Couldn’t make the letter. Please try again.' }),
      },
    )

  return (
    <>
      <select
        className="select"
        value={selected.formatId}
        onChange={(e) => pick(Number(e.target.value))}
        aria-label="Covering letter"
        disabled={view.letters.length < 2 || busy}
      >
        {view.letters.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <div className="covering-letter-preview" aria-label="Preview">
        <LetterTextPaper letter={letter} />
      </div>
      <button type="button" className="btn-link covering-letter-whole" onClick={() => setWhole(true)}>
        See the whole letter
      </button>

      {marks.length > 0 && (
        <div className="alert alert-warn covering-letter-missing" role="status">
          Still to fill in: {marks.join('; ')}. Type {marks.length === 1 ? 'it' : 'them'} in with Edit the letter
          {selected.missing.length > 0 && !fromMade ? `, or add ${marks.length === 1 ? 'it' : 'them'} to the case or the client’s family list` : ''}.
        </div>
      )}
      {made && <p className="muted small covering-letter-made">{madeLine(made)}</p>}
      {fromMade && !dirty && madeDay !== istToday() && (
        <p className="muted small covering-letter-made">
          This is the letter made on {formatDate(madeDay)}, dated that day. Start again for a fresh draft dated today.
        </p>
      )}
      {dirty && (
        <p className="muted small covering-letter-made" role="status">
          You’ve changed the letter. Make the letter to keep your changes and print them.
        </p>
      )}

      <div className="covering-letter-actions">
        <button type="button" className="btn btn-sm btn-dark" onClick={onMake} disabled={marks.length > 0 || busy}>
          {make.isPending ? 'Making…' : made ? 'Make it again' : 'Make the letter'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} disabled={busy}>
          Edit the letter
        </button>
        {(dirty || fromMade) && (
          <button type="button" className="btn btn-sm" onClick={restart} disabled={busy}>
            Start again
          </button>
        )}
        {made && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => openPrint(caseNo)}
            disabled={dirty}
            title={dirty ? 'Make the letter to print your changes' : undefined}
          >
            Print
          </button>
        )}
      </div>

      {editing && <CoveringLetterEditor letter={letter} onChange={setEdited} onClose={() => setEditing(false)} />}
      {whole && <WholeLetter name={selected.name} letter={letter} onClose={() => setWhole(false)} />}
      {asking && (
        <ConfirmDialog
          title="Discard your changes?"
          body={
            asking.kind === 'pick'
              ? 'Your changes to this letter haven’t been made into the letter. Picking another letter drops them.'
              : 'Your changes to this letter haven’t been made into the letter. Starting again drops them.'
          }
          confirmLabel="Discard"
          danger
          pending={false}
          error={null}
          onCancel={() => setAsking(null)}
          onConfirm={discard}
        />
      )}
      {dirty && <UnsavedLetterGuard />}
    </>
  )
}

/** Leaving the page or reloading with edits not made into the letter asks first. Mounted only while there are edits. */
function UnsavedLetterGuard() {
  return useLeaveGuard(true, 'Your changes to the covering letter haven’t been made into the letter yet.').dialog
}

/** "See the whole letter": the letter as it stands, edits included. */
function WholeLetter({ name, letter, onClose }: { name: string; letter: LetterText; onClose: () => void }) {
  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog covering-letter-dialog" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <h2 className="h2">{name}</h2>
        <LetterTextPaper letter={letter} />
        <div className="covering-letter-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** Read-only: the letter made, to print again; or that none was made (yet, while the file is still being prepared). */
function MadeLetter({ caseNo, view, preparing }: { caseNo: string; view: CoveringLetterView; preparing: boolean }) {
  const [whole, setWhole] = useState(false)
  if (!view.made) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {preparing ? 'Not made yet.' : 'No covering letter was made.'}
      </p>
    )
  }
  const { made } = view
  return (
    <>
      <div className="covering-letter-preview" aria-label="The letter made">
        <LetterTextPaper letter={made.letter} />
      </div>
      <button type="button" className="btn-link covering-letter-whole" onClick={() => setWhole(true)}>
        See the whole letter
      </button>
      <p className="muted small covering-letter-made">{madeLine(made)}</p>
      <div className="covering-letter-actions">
        <button type="button" className="btn btn-sm" onClick={() => openPrint(caseNo)}>
          Print
        </button>
      </div>
      {whole && <WholeLetter name={made.formatName} letter={made.letter} onClose={() => setWhole(false)} />}
    </>
  )
}
