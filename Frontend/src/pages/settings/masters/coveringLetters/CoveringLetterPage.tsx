import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { LetterPaper } from '../../../../components/LetterPaper'
import { errorText, isStale } from '../../../../lib/apiErrors'
import { formatDate } from '../../../../lib/format'
import { useToast } from '../../../../lib/toast'
import { useCoveringLetter, useRemoveWording, useUpdateCoveringLetter } from '../queries'
import type { CoveringLetter, CoveringLetterWording } from '../types'
import { DetailsDrawer } from './DetailsDrawer'
import { authorName, coverage, PARTY_LABEL } from './labels'
import { WordingEditor } from './WordingEditor'

/**
 * One covering letter (docs/decisions/0019-covering-letters.md): the wording in use, drawn like the letter, the wordings
 * still to come and the earlier ones. The Visa HOD or the Head changes the wording (kept as a new one, from the day they
 * pick), the details, or switches it off; Visa staff read it.
 */
export function CoveringLetterPage() {
  const id = Number(useParams().formatId)
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false
  const letter = useCoveringLetter(id, visa && Number.isInteger(id))

  if (!visa) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <h1 className="h2">Covering letter</h1>
        <p className="muted">The covering letters belong to the Visa department. Ask the Head for Visa access to see them.</p>
      </div>
    )
  }
  if (letter.isError) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <Link to="/settings/masters/covering-letters" className="back-link">
          ‹ Covering letters
        </Link>
        <div className="alert alert-bad">{errorText(letter.error)}</div>
      </div>
    )
  }
  if (!letter.data) return <div className="muted">Loading…</div>

  return (
    <LetterView
      letter={letter.data}
      canEdit={me ? canEditVisaMasters(me) : false}
      onReload={async () => (await letter.refetch()).data}
    />
  )
}

/** Which wording the editor is open on: a new one, or one still to come being changed. */
type Editing = { replacing: CoveringLetterWording | null }

function LetterView({ letter, canEdit, onReload }: { letter: CoveringLetter; canEdit: boolean; onReload: () => Promise<CoveringLetter | undefined> }) {
  const toast = useToast()
  const switchOnOff = useUpdateCoveringLetter()
  const remove = useRemoveWording(letter.id)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [details, setDetails] = useState(false)
  const [removing, setRemoving] = useState<CoveringLetterWording | null>(null)
  const [showEarlier, setShowEarlier] = useState(false)

  const inUse = letter.versions.find((v) => v.status === 'IN_USE') ?? null
  // Soonest first.
  const comingUp = letter.versions.filter((v) => v.status === 'SCHEDULED').reverse()
  const earlier = letter.versions.filter((v) => v.status === 'EARLIER')
  // One change at a time: while a wording is being written, the rest waits.
  const busy = editing !== null

  const setActive = () =>
    switchOnOff.mutate(
      { id: letter.id, body: { isActive: !letter.isActive, updatedAt: letter.updatedAt } },
      {
        onSuccess: () => toast({ tone: 'ok', message: `${letter.name} ${letter.isActive ? 'switched off' : 'switched on'}.` }),
        onError: (err) => {
          const message = errorText(err)
          if (message) toast({ tone: 'bad', message })
        },
      },
    )

  const confirmRemove = (wording: CoveringLetterWording) =>
    remove.mutate(
      { versionId: wording.id, updatedAt: letter.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `The wording for ${formatDate(wording.effectiveFrom)} is removed.` })
          setRemoving(null)
        },
        onError: (err) => {
          if (isStale(err)) setRemoving(null)
        },
      },
    )

  return (
    <div className="letter-page">
      <div className="page-head">
        <div>
          <Link to="/settings/masters/covering-letters" className="back-link">
            ‹ Covering letters
          </Link>
          <h1 className="h1">{letter.name}</h1>
          <p>
            {coverage(letter)} · {PARTY_LABEL[letter.party].toLowerCase()}
            {!letter.isActive && ' · switched off: cases don’t offer it'}
            {letter.isActive && !letter.visaType.isActive && ` · ${letter.visaType.name} is switched off`}
          </p>
        </div>
        {canEdit && (
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => setDetails(true)} disabled={busy} title={busy ? 'Save or cancel the wording first.' : undefined}>
              Edit details
            </button>
            <button
              type="button"
              className={letter.isActive ? 'btn btn-danger' : 'btn'}
              onClick={setActive}
              disabled={busy || switchOnOff.isPending}
              title={busy ? 'Save or cancel the wording first.' : undefined}
            >
              {letter.isActive ? 'Switch off' : 'Switch on'}
            </button>
          </div>
        )}
      </div>

      {inUse?.addedBy === null && !editing && (
        <div className="alert alert-warn">
          This is sample wording set up with the system. Replace it with Masti’s own format: change the wording, then rename the
          letter under Edit details.
        </div>
      )}

      <section className="card pad letter-card">
        {editing ? (
          <WordingEditor letter={letter} replacing={editing.replacing} onClose={() => setEditing(null)} onReload={onReload} />
        ) : (
          <>
            <div className="card-head">
              <div>
                <h2 className="h2">Wording in use</h2>
                {inUse && (
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    Since {formatDate(inUse.effectiveFrom)} · {authorName(inUse.addedBy)}
                  </p>
                )}
              </div>
              {canEdit && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing({ replacing: null })}>
                  Change the wording
                </button>
              )}
            </div>
            {inUse ? (
              <LetterPaper body={inUse.body} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Not in use yet: its first wording starts on {formatDate(comingUp[0]?.effectiveFrom ?? null)}. Cases don’t offer it
                until then.
              </p>
            )}
          </>
        )}
      </section>

      {comingUp.length > 0 && (
        <section className="card pad letter-card">
          <h2 className="h2">Coming up</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Not used yet, so they can still be changed or removed.
          </p>
          {comingUp.map((w) => (
            <WordingRow key={w.id} wording={w}>
              {canEdit && (
                <div className="row-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setEditing({ replacing: w })} disabled={busy}>
                    Change
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoving(w)} disabled={busy}>
                    Remove
                  </button>
                </div>
              )}
            </WordingRow>
          ))}
        </section>
      )}

      {earlier.length > 0 && (
        <section className="card pad letter-card">
          <button type="button" className="btn-link letter-toggle" onClick={() => setShowEarlier(!showEarlier)} aria-expanded={showEarlier}>
            {showEarlier ? '▾' : '▸'} Earlier wordings ({earlier.length})
          </button>
          {showEarlier && (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Kept as they were: letters made with them must always show what they said.
              </p>
              {earlier.map((w) => (
                <WordingRow key={w.id} wording={w} />
              ))}
            </>
          )}
        </section>
      )}

      {details && <DetailsDrawer letter={letter} onClose={() => setDetails(false)} />}
      {removing && (
        <ConfirmDialog
          title="Remove this wording?"
          body={
            inUse
              ? `The wording set to start on ${formatDate(removing.effectiveFrom)} won’t be used. The one in use stays.`
              : `The wording set to start on ${formatDate(removing.effectiveFrom)} won’t be used.`
          }
          confirmLabel="Remove"
          danger
          pending={remove.isPending}
          error={errorText(remove.error)}
          onCancel={() => setRemoving(null)}
          onConfirm={() => confirmRemove(removing)}
        />
      )}
    </div>
  )
}

/** A wording still to come or an earlier one: its day and who added it, and its text behind View. */
function WordingRow({ wording, children }: { wording: CoveringLetterWording; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="wording-row">
      <div className="wording-row-head">
        <div>
          <strong>From {formatDate(wording.effectiveFrom)}</strong>
          <div className="muted small">{wording.addedBy ? `Added by ${wording.addedBy.name}` : authorName(null)}</div>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide' : 'View'}
          </button>
          {children}
        </div>
      </div>
      {open && <LetterPaper body={wording.body} />}
    </div>
  )
}
