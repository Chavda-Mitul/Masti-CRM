import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { canEditHolidays } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useHolidayAction, useHolidays, useHolidayTargets } from '../queries'
import type { Holiday, HolidayFilter } from '../types'
import { HolidayDrawer } from './HolidayDrawer'

const FILTERS: { value: HolidayFilter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'pending', label: 'Waiting for review' },
  { value: 'removed', label: 'Removed' },
]

/** "Vimal", "Holiday bot · from IVS · checked by Vimal". */
function addedText(h: Holiday): string {
  const who = h.addedBy?.name ?? h.apiClient?.name ?? 'Set up with the system'
  const parts = [who]
  if (h.reference) parts.push(/^https?:\/\//i.test(h.reference) ? 'from a notice' : `from ${h.reference}`)
  if (h.source === 'AI_BOT' && h.reviewedBy) parts.push(`checked by ${h.reviewedBy.name}`)
  return parts.join(' · ')
}

/**
 * The holiday calendar (demo screen 29): the dates that can't be picked as collection dates, per embassy, plus our
 * office's closures. Entries from the holiday bot wait under "Waiting for review" until a person confirms them;
 * until then they only warn. Editing is for the Head and HODs.
 */
export function HolidayCalendarCard() {
  const { data: me } = useMe()
  const canEdit = me ? canEditHolidays(me) : false
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const filter: HolidayFilter = FILTERS.some((f) => f.value === params.get('holidays')) ? (params.get('holidays') as HolidayFilter) : 'upcoming'
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
  const pending = useHolidays('pending')
  const targets = useHolidayTargets()
  const action = useHolidayAction()

  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)
  const [removing, setRemoving] = useState<Holiday | null>(null)

  const pendingCount = pending.data?.length ?? 0
  const list = holidays.data ?? []

  const confirm = (h: Holiday) =>
    action.mutate(
      { id: h.id, action: 'confirm' },
      {
        onSuccess: () => toast({ tone: 'ok', message: `${h.name} confirmed. Those dates are now blocked.` }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not confirm it.' }),
      },
    )

  return (
    <section className="card holiday-card" aria-labelledby="holiday-title">
      <div className="pad card-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="h2" id="holiday-title">
            Holiday calendar — per embassy
          </h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            These dates can’t be picked as collection dates. Entries from the holiday bot wait here until someone confirms them.
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
              {f.value === 'pending' && pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}
            </button>
          ))}
        </div>
        {pendingCount > 0 && filter !== 'pending' && (
          <div className="alert alert-warn holiday-review">
            {pendingCount === 1 ? '1 holiday from the bot waits' : `${pendingCount} holidays from the bot wait`} for review. Until
            someone confirms them, they only warn.
            <button type="button" className="btn-link" onClick={() => setFilter('pending')}>
              Review now
            </button>
          </div>
        )}
      </div>

      {holidays.isPending ? (
        <div className="pad muted">Loading…</div>
      ) : holidays.isError ? (
        <div className="pad">
          <div className="alert alert-bad">{errorText(holidays.error)}</div>
        </div>
      ) : list.length === 0 ? (
        <div className="pad muted">
          {filter === 'pending'
            ? 'Nothing waiting for review.'
            : filter === 'removed'
              ? 'No removed holidays from today on.'
              : 'No holidays from today on.'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Holiday</th>
              <th>Embassy / applies to</th>
              <th>Added</th>
              {canEdit && filter !== 'removed' && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id} className={h.status === 'PENDING' ? 'row-pending' : undefined}>
                <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h.label}</td>
                <td>
                  {h.name}{' '}
                  {h.status === 'PENDING' ? (
                    <span className="chip chip-warn chip-sm">Waiting for review</span>
                  ) : (
                    h.isNew && h.status === 'ACTIVE' && <span className="chip chip-warn chip-sm">new</span>
                  )}
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
                  {h.reference && /^https?:\/\//i.test(h.reference) ? (
                    <a href={h.reference} target="_blank" rel="noreferrer">
                      {addedText(h)}
                    </a>
                  ) : (
                    addedText(h)
                  )}
                </td>
                {canEdit && filter !== 'removed' && (
                  <td>
                    <div className="row-actions">
                      {h.status === 'PENDING' && (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => confirm(h)} disabled={action.isPending}>
                          Confirm
                        </button>
                      )}
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
          body={
            removing.status === 'PENDING'
              ? 'The bot’s entry is turned down: it won’t block any dates, and the bot can’t send it again.'
              : `${removing.label} can be picked as collection dates again. It stays under “Removed” for the record.`
          }
          confirmLabel="Remove"
          danger
          pending={action.isPending}
          error={errorText(action.error)}
          onCancel={() => {
            setRemoving(null)
            action.reset()
          }}
          onConfirm={() =>
            action.mutate(
              { id: removing.id, action: 'remove' },
              {
                onSuccess: () => {
                  toast({ tone: 'ok', message: `${removing.name} removed.` })
                  setRemoving(null)
                },
              },
            )
          }
        />
      )}
    </section>
  )
}
