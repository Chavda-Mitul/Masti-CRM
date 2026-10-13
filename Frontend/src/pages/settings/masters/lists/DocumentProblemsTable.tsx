import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { documentProblemFormSchema, type DocumentProblemFormValues } from '../schemas'
import type { DocumentProblemReason } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * Why a paper needs replacing: "Not signed", "Wrong photo size"… The processor picks one when checking the papers in
 * Step 3 (docs/decisions/0007-visa-file-prep.md Decision 3). No free text: reports count these.
 */
export function DocumentProblemsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('document-problem-reasons')
  const [editing, setEditing] = useState<DocumentProblemReason | 'new' | null>(null)
  const rows = (list.data ?? []).filter((r) => showInactive || r.isActive)

  return (
    <>
      <ListCard
        title="Document problems"
        count={rows.length}
        addLabel="Add a reason"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No reasons yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Reason</th>
              <th>Order</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.isActive ? undefined : 'row-off'}>
                <td className="mono">{r.code}</td>
                <td style={{ fontWeight: 700 }}>{r.name}</td>
                <td>{r.sortOrder}</td>
                <td>{r.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="document-problem-reasons" id={r.id} name={r.name} isActive={r.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <DocumentProblemDrawer reason={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function DocumentProblemDrawer({ reason, onClose }: { reason: DocumentProblemReason | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('document-problem-reasons')
  const { register, handleSubmit, setError, formState } = useForm<DocumentProblemFormValues>({
    resolver: zodResolver(documentProblemFormSchema),
    defaultValues: { code: reason?.code ?? '', name: reason?.name ?? '', sortOrder: reason?.sortOrder ?? 0 },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder }
    save.mutate(reason ? { id: reason.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder']),
    })
  })

  return (
    <MasterDrawer
      title={reason ? `Edit ${reason.name}` : 'Add a reason'}
      intro="What can be wrong with a paper. The processor picks one when a paper needs replacing."
      submitLabel={reason ? 'Save changes' : 'Add reason'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={reason ? 'Codes never change.' : 'e.g. NOT_SIGNED.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!reason} autoFocus={!reason} />
      </FormField>
      <FormField label="Reason" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Not signed" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
