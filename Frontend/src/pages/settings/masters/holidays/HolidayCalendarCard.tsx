import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { canEditHolidays } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useHolidays, useHolidayTargets, useRemoveHoliday } from '../queries'
import type { Holiday, HolidayFilter } from '../types'
import { HolidayDrawer } from './HolidayDrawer'

const FILTERS: { value: HolidayFilter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'removed', label: 'Removed' },
]

const isLink = (reference: string) => /^https?:\/\//i.test(reference)

/** "Vimal", "Vimal · from IVS". */
function addedText(h: Holiday): string {
  const parts = [h.addedBy?.name ?? 'Set up with the system']
  if (h.reference) parts.push(isLink(h.reference) ? 'from a notice' : `from ${h.reference}`)
  return parts.join(' · ')
}

/**
 * The holiday calendar (demo screen 29): the dates that can't be picked as collection dates, per embassy, plus our
 * office's closures. Staff-entered; the Head and HODs change it.
 */
export function HolidayCalendarCard() {
  const { data: me } = useMe()
  const canEdit = me ? canEditHolidays(me) : false
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const filter: HolidayFilter = params.get('holidays') === 'removed' ? 'removed' : 'upcoming'
  const setFilter = (value: HolidayFilter) =>
    setParams(
      (p) => {
        if (value === 'upcoming') p.delete('holidays')
        else p.set('holidays', value)
        return p
      },
      { replace: true },
    )

  const holidays = useHolidays(filter)
  const targets = useHolidayTargets()
  const remove = useRemoveHoliday()

  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)
  const [removing, setRemoving] = useState<Holiday | null>(null)

  const list = holidays.data ?? []
  const showActions = canEdit && filter === 'upcoming'

  return (
    <section className="card holiday-card" aria-labelledby="holiday-title">
      <div className="pad card-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="h2" id="holiday-title">
            Holiday calendar — per embassy
          </h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            These dates can’t be picked as collection dates.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')} disabled={!targets.data}>
            Add a holiday
          </button>
        )}
      </div>

      <div className="pad holiday-tools">
        <div className="kind-toggle" role="tablist" aria-label="Which holidays">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={filter === f.value ? 'on' : ''}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {holidays.isPending ? (
        <div className="pad muted">Loading…</div>
      ) : holidays.isError ? (
        <div className="pad">
          <div className="alert alert-bad">{errorText(holidays.error)}</div>
        </div>
      ) : list.length === 0 ? (
        <div className="pad muted">{filter === 'removed' ? 'No removed holidays from today on.' : 'No holidays from today on.'}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Holiday</th>
              <th>Embassy / applies to</th>
              <th>Added</th>
              {showActions && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id}>
                <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h.label}</td>
                <td>
                  {h.name} {h.isNew && h.status === 'ACTIVE' && <span className="chip chip-warn chip-sm">new</span>}
                </td>
                <td>
                  <div className="chip-row">
                    {h.targets.map((t) => (
                      <span key={t.label} className="chip chip-muted chip-sm">
                        {t.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="muted">
                  {h.reference && isLink(h.reference) ? (
                    <a href={h.reference} target="_blank" rel="noreferrer">
                      {addedText(h)}
                    </a>
                  ) : (
                    addedText(h)
                  )}
                </td>
                {showActions && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(h)} disabled={!targets.data}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoving(h)}>
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && targets.data && (
        <HolidayDrawer holiday={editing === 'new' ? null : editing} options={targets.data} onClose={() => setEditing(null)} />
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          body={`${removing.label} can be picked as collection dates again. It stays under “Removed” for the record.`}
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
    </section>
  )
}
