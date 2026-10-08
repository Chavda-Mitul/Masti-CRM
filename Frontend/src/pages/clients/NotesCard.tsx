import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { formatDateTime } from '../../lib/format'
import { errorText } from './apiErrors'
import { useAddNote, useClientNotes } from './queries'
import { noteFormSchema, type NoteFormValues } from './schemas'
import type { ClientNote } from './types'

/** Free-text notes, newest first. Append-only: no editing or deleting, and never used in reports. */
export function NotesCard({ clientId, latest, canEdit }: { clientId: string; latest: ClientNote[]; canEdit: boolean }) {
  const notes = useClientNotes(clientId)
  const add = useAddNote(clientId)
  const { register, handleSubmit, reset, formState } = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { body: '' },
  })

  const onSubmit = handleSubmit((values) => add.mutate({ body: values.body }, { onSuccess: () => reset() }))
  // The profile already carries the latest notes, so they show while the full log loads.
  const list = notes.data ?? latest

  return (
    <div className="card">
      <div className="pad card-head">
        <h2 className="h2">Notes</h2>
        <span className="hint">Not used in reports</span>
      </div>

      {canEdit && (
        <form className="pad note-form" onSubmit={onSubmit} noValidate>
          <textarea className="input textarea" rows={2} placeholder="e.g. Prefers calls after 6 pm." {...register('body')} />
          {formState.errors.body && <span className="field-error">{formState.errors.body.message}</span>}
          {errorText(add.error) && <div className="alert alert-bad">{errorText(add.error)}</div>}
          <button type="submit" className="btn btn-sm" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add note'}
          </button>
        </form>
      )}

      {list.length === 0 ? (
        <div className="pad muted" style={{ paddingTop: 0 }}>
          No notes yet.
        </div>
      ) : (
        <ol className="notes">
          {list.map((n) => (
            <li key={n.id}>
              <p>{n.body}</p>
              <span className="muted small">
                {n.author.name} · {formatDateTime(n.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
