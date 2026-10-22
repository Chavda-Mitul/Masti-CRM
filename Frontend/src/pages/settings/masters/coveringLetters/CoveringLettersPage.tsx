import { useState } from 'react'
import { Link } from 'react-router'
import { canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { RefreshFailed } from '../../../../components/RefreshFailed'
import { errorText, lostAccess } from '../../../../lib/apiErrors'
import { formatDate } from '../../../../lib/format'
import { useToast } from '../../../../lib/toast'
import { useCoveringLetters, useUpdateCoveringLetter } from '../queries'
import type { CoveringLetterSummary } from '../types'
import { coverage, PARTY_LABEL } from './labels'
import { PrintingCard } from './PrintingCard'

/**
 * Covering letters (docs/decisions/0019-covering-letters.md; demo screen 29's "Covering letters · 3 fixed formats"): one
 * fixed letter per visa type, countries and who travels. Visa staff can look; the Visa HOD or the Head adds and changes
 * them.
 */
export function CoveringLettersPage() {
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false
  const canEdit = me ? canEditVisaMasters(me) : false
  const letters = useCoveringLetters(visa)
  const [showOff, setShowOff] = useState(false)

  if (!visa) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <h1 className="h2">Covering letters</h1>
        <p className="muted">The covering letters belong to the Visa department. Ask the Head for Visa access to see them.</p>
      </div>
    )
  }

  const all = letters.data ?? []
  const switchedOff = all.filter((f) => !f.isActive).length
  const rows = all.filter((f) => showOff || f.isActive)

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/settings/masters" className="back-link">
            ‹ Masters
          </Link>
          <h1 className="h1">Covering letters</h1>
          <p>
            The fixed letter to the embassy for each visa and who travels. The case fills in its travellers, passports and dates,
            and the letter is printed on the client’s letterhead. A new wording applies from the day you pick.
          </p>
        </div>
        {canEdit && (
          <Link to="/settings/masters/covering-letters/new" className="btn btn-primary">
            + Add a covering letter
          </Link>
        )}
      </div>

      <RefreshFailed query={letters} what="the list" />
      <section className="card card-fill" style={{ overflow: 'hidden' }}>
        {switchedOff > 0 && (
          <div className="pad letters-tools">
            <label className="check">
              <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
              <span>Show switched-off ({switchedOff})</span>
            </label>
          </div>
        )}
        {letters.isPending ? (
          <div className="pad muted card-fill-empty">Loading…</div>
        ) : letters.isLoadingError || lostAccess(letters) ? (
          <div className="pad">
            <div className="alert alert-bad">{errorText(letters.error)}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad muted card-fill-empty">No covering letters yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Letter</th>
                <th>For</th>
                <th>Wording</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <LetterRow key={f.id} letter={f} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <PrintingCard canEdit={canEdit} />
    </>
  )
}

function LetterRow({ letter: f, canEdit }: { letter: CoveringLetterSummary; canEdit: boolean }) {
  const toast = useToast()
  const toggle = useUpdateCoveringLetter()
  const href = `/settings/masters/covering-letters/${f.id}`
  const setActive = () =>
    toggle.mutate(
      { id: f.id, body: { isActive: !f.isActive, updatedAt: f.updatedAt } },
      {
        onSuccess: () => toast({ tone: 'ok', message: `${f.name} ${f.isActive ? 'switched off' : 'switched on'}.` }),
        onError: (err) => {
          const message = errorText(err)
          if (message) toast({ tone: 'bad', message })
        },
      },
    )

  return (
    <tr className={f.isActive ? undefined : 'row-off'}>
      <td>
        <Link to={href} style={{ fontWeight: 700 }}>
          {f.name}
        </Link>
        <div className="muted small">{coverage(f)}</div>
      </td>
      <td>{PARTY_LABEL[f.party]}</td>
      <td className="small">
        {f.inUse ? (
          <>
            In use since {formatDate(f.inUse.effectiveFrom)}
            {f.inUse.addedBy === null && <span className="chip chip-warn chip-sm letters-sample">Sample</span>}
          </>
        ) : (
          <span className="chip chip-warn chip-sm">Starts {formatDate(f.next?.effectiveFrom ?? null)}</span>
        )}
        {f.inUse && f.next && <div className="muted">Next wording from {formatDate(f.next.effectiveFrom)}</div>}
      </td>
      <td>
        {!f.isActive ? (
          <span className="chip chip-muted chip-sm">Switched off</span>
        ) : (
          <span className="chip chip-ok chip-sm">Active</span>
        )}
        {!f.visaType.isActive && <div className="muted small">{f.visaType.name} is switched off</div>}
      </td>
      <td>
        <div className="row-actions">
          <Link className="btn btn-sm" to={href}>
            Open
          </Link>
          {canEdit && (
            <button type="button" className={f.isActive ? 'btn btn-sm btn-danger' : 'btn btn-sm'} onClick={setActive} disabled={toggle.isPending}>
              {f.isActive ? 'Switch off' : 'Switch on'}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
