import { Link } from 'react-router'
import { errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { usePortalLogins } from '../../portals/queries'
import { useSaveOffering } from '../queries'

/**
 * Which portal this visa's cases open with Log in for me (docs/decisions/0024-portal-logins.md component 3): one of the
 * Visa department's portals, picked by the Head or the Visa HOD and saved at once, like the switches above. Others see
 * its name only.
 */
export function VisaPortalCard({
  offeringId,
  portal,
  canEdit,
  disabled,
}: {
  offeringId: number
  portal: { id: string; name: string } | null
  canEdit: boolean
  /** Unsaved checklist changes: saving the visa would make them stale. */
  disabled: boolean
}) {
  const toast = useToast()
  const save = useSaveOffering()
  const portals = usePortalLogins()
  const options = (portals.data?.portals ?? []).filter((p) => p.department.code === 'VISA')

  const pick = (portalLoginId: string | null) =>
    save.mutate(
      { id: offeringId, body: { portalLoginId } },
      {
        onSuccess: (saved) =>
          toast({ tone: 'ok', message: saved.portal ? `Cases of this visa now open ${saved.portal.name}.` : 'Cases of this visa no longer open a portal.' }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not change it.' }),
      },
    )

  return (
    <section className="card pad visa-portal-card">
      <h2 className="h2">Log in for me</h2>
      <p className="muted small">The government portal this visa's cases open, from step 3. Staff never see its ID or password.</p>
      {canEdit ? (
        <label className="field">
          <span>Portal for this visa</span>
          <select className="select" value={portal?.id ?? ''} disabled={disabled || save.isPending} onChange={(e) => pick(e.target.value || null)}>
            <option value="">No portal</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {portal && !options.some((p) => p.id === portal.id) && <option value={portal.id}>{portal.name}</option>}
          </select>
          {disabled && <span className="hint">Save or discard your checklist changes first.</span>}
        </label>
      ) : (
        <p className="small">{portal ? portal.name : 'No portal saved for this visa.'}</p>
      )}
      {canEdit && (
        <p className="muted small">
          Add or change the portals themselves in <Link to="/settings/portals">Settings → Portal logins</Link>.
        </p>
      )}
    </section>
  )
}
