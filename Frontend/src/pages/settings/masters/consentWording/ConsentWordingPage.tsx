import { useState } from 'react'
import { Link } from 'react-router'
import { canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { ConsentWording } from '../../../../components/ConsentWording'
import { RefreshFailed } from '../../../../components/RefreshFailed'
import { errorText, lostAccess } from '../../../../lib/apiErrors'
import { authorName } from '../coveringLetters/labels'
import { useConsentWordings } from '../queries'
import type { ConsentWordingVersion } from '../types'
import { ConsentWordingEditor } from './ConsentWordingEditor'
import { sinceDay } from './labels'

/**
 * Settings → Masters → Consent wording (docs/decisions/0022-consent-form.md, part 2b): the words clients agree to with
 * "I agree", drawn as their phone shows them. The Visa HOD or the Head changes them, kept as a new version from that
 * moment; Visa staff read them. Consents already given keep the version they were given to.
 */
export function ConsentWordingPage() {
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false
  const wordings = useConsentWordings(visa)
  const [editing, setEditing] = useState(false)
  const [showEarlier, setShowEarlier] = useState(false)

  if (!visa) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <h1 className="h2">Consent wording</h1>
        <p className="muted">The consent form belongs to the Visa department. Ask the Head for Visa access to see it.</p>
      </div>
    )
  }
  if (wordings.isLoadingError || lostAccess(wordings)) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <Link to="/settings/masters" className="back-link">
          ‹ Masters
        </Link>
        <div className="alert alert-bad">{errorText(wordings.error)}</div>
      </div>
    )
  }
  if (!wordings.data) return <div className="muted">Loading…</div>

  const [inUse, ...earlier] = wordings.data
  const canEdit = me ? canEditVisaMasters(me) : false

  return (
    <div className="letter-page">
      <div className="page-head">
        <div>
          <Link to="/settings/masters" className="back-link">
            ‹ Masters
          </Link>
          <h1 className="h1">Consent wording</h1>
          <p>
            The consent &amp; liability form clients agree to with <strong>I agree</strong> on the link we send them, once in
            their life.
          </p>
        </div>
      </div>

      <RefreshFailed query={wordings} what="the wording" />

      <section className="card pad letter-card">
        {inUse && editing ? (
          <ConsentWordingEditor inUse={inUse} onClose={() => setEditing(false)} onReload={async () => (await wordings.refetch()).data?.[0]} />
        ) : (
          <>
            <div className="card-head">
              <div>
                <h2 className="h2">Wording in use</h2>
                {inUse && (
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    Since {sinceDay(inUse.createdAt)} · {authorName(inUse.addedBy)}
                  </p>
                )}
              </div>
              {inUse && canEdit && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
                  Change the wording
                </button>
              )}
            </div>
            {inUse ? (
              <ConsentWording body={inUse.body} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No wording yet: the server adds it when it starts.
              </p>
            )}
          </>
        )}
      </section>

      {earlier.length > 0 && (
        <section className="card pad letter-card">
          <button type="button" className="btn-link letter-toggle" onClick={() => setShowEarlier(!showEarlier)} aria-expanded={showEarlier}>
            {showEarlier ? '▾' : '▸'} Earlier wordings ({earlier.length})
          </button>
          {showEarlier && (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Kept as they were: each consent always shows the words it was given to.
              </p>
              {earlier.map((w) => (
                <WordingRow key={w.id} wording={w} />
              ))}
            </>
          )}
        </section>
      )}
    </div>
  )
}

/** An earlier version: since when and who added it, and its words behind View. */
function WordingRow({ wording }: { wording: ConsentWordingVersion }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="wording-row">
      <div className="wording-row-head">
        <div>
          <strong>From {sinceDay(wording.createdAt)}</strong>
          <div className="muted small">{wording.addedBy ? `Added by ${wording.addedBy.name}` : authorName(null)}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : 'View'}
        </button>
      </div>
      {open && <ConsentWording body={wording.body} />}
    </div>
  )
}
