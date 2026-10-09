import type { FormEventHandler, ReactNode } from 'react'
import { errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useSaveMaster } from '../queries'
import type { MasterResource } from '../types'

/** The drawer every small master list uses to add or change a row. The fields come from the caller. */
export function MasterDrawer({
  title,
  intro,
  submitLabel,
  pending,
  error,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  intro: string
  submitLabel: string
  pending: boolean
  error: unknown
  onClose: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  children: ReactNode
}) {
  const message = errorText(error)
  return (
    <div className="overlay" onClick={onClose}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} noValidate>
        <div className="pad drawer-head">
          <h2 className="h2">{title}</h2>
          <p className="muted">{intro}</p>
        </div>
        <div className="pad drawer-body">
          <div className="form-grid">{children}</div>
          {message && (
            <div className="alert alert-bad" role="alert">
              {message}
            </div>
          )}
        </div>
        <div className="pad drawer-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Masters are switched off, never deleted, so old cases and reports keep their names. A switched-off row disappears
 * from dropdowns. The server refuses some (a document still on an active checklist) and says why.
 */
export function ToggleActiveButton({ resource, id, name, isActive }: { resource: MasterResource; id: number; name: string; isActive: boolean }) {
  const toast = useToast()
  const save = useSaveMaster(resource)
  const toggle = () =>
    save.mutate(
      { id, body: { isActive: !isActive } },
      {
        onSuccess: () => toast({ tone: 'ok', message: isActive ? `${name} switched off.` : `${name} switched on.` }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not change it.' }),
      },
    )
  return (
    <button type="button" className={isActive ? 'btn btn-sm btn-danger' : 'btn btn-sm'} onClick={toggle} disabled={save.isPending}>
      {isActive ? 'Switch off' : 'Switch on'}
    </button>
  )
}
