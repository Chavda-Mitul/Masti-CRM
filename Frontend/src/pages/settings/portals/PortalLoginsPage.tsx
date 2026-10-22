import { useState } from 'react'
import { useMe } from '../../../auth/useAuth'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { RefreshFailed } from '../../../components/RefreshFailed'
import { errorText, lostAccess } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import '../../../styles/portals.css'
import type { PressResult } from './labels'
import { PortalCard } from './PortalCard'
import { PortalDrawer } from './PortalDrawer'
import { usePortalLogins, useRemovePortal } from './queries'
import type { Portal } from './types'
import { WhoUsedWhatCard } from './WhoUsedWhatCard'

/**
 * Settings → Portal logins (docs/decisions/0024-portal-logins.md, demo screen 28). The Head and a department's HOD add,
 * change and remove its portals and see who used what; staff see the portals they're on the list for. Everyone presses
 * Log in for me and never sees the ID or password.
 */
export function PortalLoginsPage() {
  const { data: me } = useMe()
  const toast = useToast()
  const page = usePortalLogins()
  const remove = useRemovePortal()
  const [editing, setEditing] = useState<Portal | 'new' | null>(null)
  const [removing, setRemoving] = useState<Portal | null>(null)
  /** What each card's last press said, while it needs doing something about. */
  const [results, setResults] = useState<Record<string, PressResult>>({})

  if (!me) return null

  const data = page.data
  const manages = (data?.addTo.length ?? 0) > 0

  const onResult = (portalId: string) => (result: PressResult) => {
    toast({ tone: result.tone, message: result.message })
    setResults((previous) => {
      const next = { ...previous }
      if (result.keep) next[portalId] = result
      else delete next[portalId]
      return next
    })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Portal logins</h1>
          <p>
            Visa and airline accounts belong to the company. Staff press "Log in for me" and never see the ID or password, so
            when someone leaves, switching off their CRM login is enough.
          </p>
          <p>
            Passwords change on the schedule you set. On the due date the HOD is asked to reset; the account stays locked for
            everyone until that's done.
          </p>
        </div>
        {manages && data?.ready && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add a portal
          </button>
        )}
      </div>

      <RefreshFailed query={page} what="the portal logins" />
      {page.isPending ? (
        <p className="muted">Loading…</p>
      ) : page.isLoadingError || lostAccess(page) ? (
        <div className="alert alert-bad">{errorText(page.error)}</div>
      ) : (
        data && (
          <>
            {!data.ready && <div className="alert alert-bad portal-strip">Portal logins aren't set up on this server yet.</div>}
            {manages && !data.officeAddressesSet && (
              <div className="alert alert-warn portal-strip">
                Masti's office internet addresses aren't set yet, so Log in for me works from anywhere for now. Once they are,
                it works only in the office.
              </div>
            )}

            {data.portals.length === 0 && !manages ? (
              <p className="muted">You aren't on any portal's list yet. Your HOD adds you.</p>
            ) : (
              <div className="masters-grid portal-grid">
                {data.portals.map((portal) => (
                  <PortalCard
                    key={portal.id}
                    portal={portal}
                    helperIds={data.helperIds}
                    result={results[portal.id]}
                    onResult={onResult(portal.id)}
                    onEdit={() => setEditing(portal)}
                    onRemove={() => setRemoving(portal)}
                  />
                ))}
                {manages && data.portals.length === 0 && (
                  <section className="card pad portal-card">
                    <p className="muted">No portals yet. Add the first one with "+ Add a portal".</p>
                  </section>
                )}
                {manages && <WhoUsedWhatCard uses={data.uses} />}
              </div>
            )}

            {editing && <PortalDrawer portal={editing === 'new' ? null : editing} departments={data.addTo} onClose={() => setEditing(null)} />}
          </>
        )
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          body="Nobody can use it from the CRM any more, and its saved ID and password are wiped. Who used it stays in the records."
          confirmLabel="Remove"
          danger
          pending={remove.isPending}
          error={errorText(remove.error)}
          onCancel={() => {
            setRemoving(null)
            remove.reset()
          }}
          onConfirm={() =>
            remove.mutate(removing.id, {
              onSuccess: () => {
                toast({ tone: 'ok', message: `${removing.name} removed.` })
                setRemoving(null)
              },
            })
          }
        />
      )}
    </>
  )
}
