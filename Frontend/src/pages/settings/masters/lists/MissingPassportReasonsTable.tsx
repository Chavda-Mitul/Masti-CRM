import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { missingPassportReasonFormSchema, type MissingPassportReasonFormValues } from '../schemas'
import type { MissingPassportReason } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * Why fewer passports came back than went out, when the shortfall is cleared rather than found
 * (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026): picked, never typed, so reports can count
 * why passports go missing.
 */
export function MissingPassportReasonsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('missing-passport-reasons')
  const [editing, setEditing] = useState<MissingPassportReason | 'new' | null>(null)
  const rows = (list.data ?? []).filter((r) => showInactive || r.isActive)

  return (
    <>
      <ListCard
        title="Missing passport reasons"
        count={rows.length}
        addLabel="Add a reason"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No missing passport reasons yet."
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
                      <ToggleActiveButton resource="missing-passport-reasons" id={r.id} name={r.name} isActive={r.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <ReasonDrawer reason={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ReasonDrawer({ reason, onClose }: { reason: MissingPassportReason | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('missing-passport-reasons')
  const { register, handleSubmit, setError, formState } = useForm<MissingPassportReasonFormValues>({
    resolver: zodResolver(missingPassportReasonFormSchema),
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
      title={reason ? `Edit ${reason.name}` : 'Add a missing passport reason'}
      intro="Why a missing passport won't come back. Picked when a shortfall is cleared."
      submitLabel={reason ? 'Save changes' : 'Add reason'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={reason ? 'Codes never change.' : 'e.g. EMBASSY_KEPT.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!reason} autoFocus={!reason} />
      </FormField>
      <FormField label="Reason" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Embassy kept it" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
