import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { creditNoteReasonFormSchema, type CreditNoteReasonFormValues } from '../schemas'
import type { CreditNoteReason } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * Why a credit note is issued (docs/decisions/0011-visa-at-vendor.md Decision 5): picked when an invoice is cancelled,
 * never typed, so the accounts stay structured.
 */
export function CreditNoteReasonsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('credit-note-reasons')
  const [editing, setEditing] = useState<CreditNoteReason | 'new' | null>(null)
  const rows = (list.data ?? []).filter((r) => showInactive || r.isActive)

  return (
    <>
      <ListCard
        title="Credit-note reasons"
        count={rows.length}
        addLabel="Add a reason"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No credit-note reasons yet."
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
                      <ToggleActiveButton resource="credit-note-reasons" id={r.id} name={r.name} isActive={r.isActive} />
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

function ReasonDrawer({ reason, onClose }: { reason: CreditNoteReason | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('credit-note-reasons')
  const { register, handleSubmit, setError, formState } = useForm<CreditNoteReasonFormValues>({
    resolver: zodResolver(creditNoteReasonFormSchema),
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
      title={reason ? `Edit ${reason.name}` : 'Add a credit-note reason'}
      intro="Why a credit note is issued. Picked when an invoice is cancelled."
      submitLabel={reason ? 'Save changes' : 'Add reason'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={reason ? 'Codes never change.' : 'e.g. WRONG_AMOUNT.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!reason} autoFocus={!reason} />
      </FormField>
      <FormField label="Reason" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Wrong amount" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
