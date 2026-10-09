import type { ReactNode } from 'react'
import { errorText } from '../../../../lib/apiErrors'

/** The card around one master list: title, count, "Add" button, and loading / error / empty states. */
export function ListCard({
  title,
  count,
  addLabel,
  canEdit,
  onAdd,
  query,
  empty,
  toolbar,
  children,
}: {
  title: string
  count: number
  addLabel: string
  canEdit: boolean
  onAdd: () => void
  query: { isPending: boolean; isError: boolean; error: unknown }
  empty: string
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card card-fill" style={{ overflow: 'hidden' }}>
      <div className="pad card-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 className="h2">{title}</h2>
          <span className="chip chip-muted">{count}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {toolbar}
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
              + {addLabel}
            </button>
          )}
        </div>
      </div>
      {query.isPending ? (
        <div className="pad muted card-fill-empty">Loading…</div>
      ) : query.isError ? (
        <div className="pad">
          <div className="alert alert-bad">{errorText(query.error)}</div>
        </div>
      ) : count === 0 ? (
        <div className="pad muted card-fill-empty">{empty}</div>
      ) : (
        children
      )}
    </section>
  )
}
