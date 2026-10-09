import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useOfferings, useSaveOffering } from '../queries'
import type { Offering } from '../types'

/**
 * Document checklists: one per country × visa type ("23 country × type" on the demo). Each opens in the editor.
 * Visa staff can look; the Visa HOD or the Head adds visas and changes checklists.
 */
export function ChecklistsPage() {
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false
  const canEdit = me ? canEditVisaMasters(me) : false
  const offerings = useOfferings(visa)
  const toast = useToast()
  const toggle = useSaveOffering()
  const [adding, setAdding] = useState(false)

  if (!visa) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <h1 className="h2">Document checklists</h1>
        <p className="muted">The checklists belong to the Visa department. Ask the Head for Visa access to see them.</p>
      </div>
    )
  }

  const list = offerings.data ?? []
  const setActive = (o: Offering) =>
    toggle.mutate(
      { id: o.id, body: { isActive: !o.isActive } },
      {
        onSuccess: () => toast({ tone: 'ok', message: `${o.label} ${o.isActive ? 'switched off' : 'switched on'}.` }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not change it.' }),
      },
    )

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/settings/masters" className="back-link">
            ‹ Masters
          </Link>
          <h1 className="h1">Document checklists</h1>
          <p>
            What each visa needs, for adults and for children. Picking a country and visa type at intake copies its checklist onto
            each traveller, so changing one here doesn’t touch cases already open.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add country × visa type
          </button>
        )}
      </div>

      <section className="card card-fill" style={{ overflow: 'hidden' }}>
        {offerings.isPending ? (
          <div className="pad muted card-fill-empty">Loading…</div>
        ) : offerings.isError ? (
          <div className="pad">
            <div className="alert alert-bad">{errorText(offerings.error)}</div>
          </div>
        ) : list.length === 0 ? (
          <div className="pad muted card-fill-empty">No visas set up yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Visa</th>
                <th>Documents</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className={o.isActive ? undefined : 'row-off'}>
                  <td style={{ fontWeight: 700 }}>
                    <Link to={`/settings/masters/checklists/${o.id}`}>{o.label}</Link>
                  </td>
                  <td>
                    {o.checklistCount ? (
                      o.checklistCount
                    ) : (
                      <span className="chip chip-warn chip-sm">No checklist yet</span>
                    )}
                  </td>
                  <td>
                    {!o.isActive ? (
                      <span className="chip chip-muted chip-sm">Switched off</span>
                    ) : !o.country.isActive || !o.visaType.isActive ? (
                      <span className="chip chip-muted chip-sm">Hidden: {o.country.isActive ? 'visa type' : 'country'} switched off</span>
                    ) : (
                      <span className="chip chip-ok chip-sm">Active</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Link className="btn btn-sm" to={`/settings/masters/checklists/${o.id}`}>
                        {canEdit ? 'Edit checklist' : 'Open'}
                      </Link>
                      {canEdit && (
                        <button type="button" className={o.isActive ? 'btn btn-sm btn-danger' : 'btn btn-sm'} onClick={() => setActive(o)} disabled={toggle.isPending}>
                          {o.isActive ? 'Switch off' : 'Switch on'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {adding && <AddOfferingDialog existing={list} onClose={() => setAdding(false)} />}
    </>
  )
}

/** Picks a country and a visa type not set up yet, then opens the new (empty) checklist. */
function AddOfferingDialog({ existing, onClose }: { existing: Offering[]; onClose: () => void }) {
  const navigate = useNavigate()
  const countries = useMasterList('countries')
  const visaTypes = useMasterList('visa-types')
  const save = useSaveOffering()
  const [countryId, setCountryId] = useState('')
  const [visaTypeId, setVisaTypeId] = useState('')

  const taken = new Set(existing.map((o) => `${o.country.id}:${o.visaType.id}`))
  const already = countryId && visaTypeId && taken.has(`${countryId}:${visaTypeId}`)

  const create = () =>
    save.mutate(
      { body: { countryId: Number(countryId), visaTypeId: Number(visaTypeId) } },
      { onSuccess: (offering) => navigate(`/settings/masters/checklists/${offering.id}`) },
    )

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-offering" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="add-offering">
          Add a country × visa type
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Then add its documents. A missing country or visa type can be added under Masters → Lists.
        </p>
        <label className="field">
          Country
          <select className="select" value={countryId} onChange={(e) => setCountryId(e.target.value)} disabled={!countries.data}>
            <option value="">Pick a country</option>
            {countries.data
              ?.filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.zone ? `${c.name} (${c.zone})` : c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Visa type
          <select className="select" value={visaTypeId} onChange={(e) => setVisaTypeId(e.target.value)} disabled={!visaTypes.data}>
            <option value="">Pick a visa type</option>
            {visaTypes.data
              ?.filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        {already && <div className="alert alert-warn">This one is already set up.</div>}
        {save.error && <div className="alert alert-bad">{errorText(save.error)}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={!countryId || !visaTypeId || !!already || save.isPending}>
            {save.isPending ? 'Adding…' : 'Add and open'}
          </button>
        </div>
      </div>
    </div>
  )
}
