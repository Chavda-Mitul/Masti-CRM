import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { extraChargeFormSchema, type ExtraChargeFormValues } from '../schemas'
import type { ExtraCharge } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * What an additional invoice charges for (docs/decisions/0011-visa-at-vendor.md Decision 7): picked when it's raised,
 * with the amount typed, never free text. No GST is charged on them.
 */
export function ExtraChargesTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('extra-charges')
  const [editing, setEditing] = useState<ExtraCharge | 'new' | null>(null)
  const rows = (list.data ?? []).filter((r) => showInactive || r.isActive)

  return (
    <>
      <ListCard
        title="Extra charges"
        count={rows.length}
        addLabel="Add a charge"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No extra charges yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Charge</th>
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
                      <ToggleActiveButton resource="extra-charges" id={r.id} name={r.name} isActive={r.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <ChargeDrawer charge={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ChargeDrawer({ charge, onClose }: { charge: ExtraCharge | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('extra-charges')
  const { register, handleSubmit, setError, formState } = useForm<ExtraChargeFormValues>({
    resolver: zodResolver(extraChargeFormSchema),
    defaultValues: { code: charge?.code ?? '', name: charge?.name ?? '', sortOrder: charge?.sortOrder ?? 0 },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder }
    save.mutate(charge ? { id: charge.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder']),
    })
  })

  return (
    <MasterDrawer
      title={charge ? `Edit ${charge.name}` : 'Add an extra charge'}
      intro="What an additional invoice charges for. Picked when it's raised; the amount is typed then."
      submitLabel={charge ? 'Save changes' : 'Add charge'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={charge ? 'Codes never change.' : 'e.g. URGENT_SUBMISSION.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!charge} autoFocus={!charge} />
      </FormField>
      <FormField label="Charge" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Urgent submission" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
