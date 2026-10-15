import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { courierFormSchema, type CourierFormValues } from '../schemas'
import type { Courier } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * How a docket goes to the vendor (docs/decisions/0008-visa-docket-dispatch.md Decision 6): picked at dispatch, no free
 * text. "AWB needed" is off for one with no slip number, like "By hand".
 */
export function CouriersTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('couriers')
  const [editing, setEditing] = useState<Courier | 'new' | null>(null)
  const rows = (list.data ?? []).filter((c) => showInactive || c.isActive)

  return (
    <>
      <ListCard
        title="Couriers"
        count={rows.length}
        addLabel="Add a courier"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No couriers yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Courier</th>
              <th>Slip (AWB) number</th>
              <th>Order</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.isActive ? undefined : 'row-off'}>
                <td className="mono">{c.code}</td>
                <td style={{ fontWeight: 700 }}>{c.name}</td>
                <td>{c.awbNeeded ? 'Needed' : <span className="muted">Not asked for</span>}</td>
                <td>{c.sortOrder}</td>
                <td>{c.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(c)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="couriers" id={c.id} name={c.name} isActive={c.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <CourierDrawer courier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CourierDrawer({ courier, onClose }: { courier: Courier | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('couriers')
  const { register, handleSubmit, setError, formState } = useForm<CourierFormValues>({
    resolver: zodResolver(courierFormSchema),
    defaultValues: {
      code: courier?.code ?? '',
      name: courier?.name ?? '',
      sortOrder: courier?.sortOrder ?? 0,
      awbNeeded: courier?.awbNeeded ?? true,
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder, awbNeeded: v.awbNeeded }
    save.mutate(courier ? { id: courier.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder', 'awbNeeded']),
    })
  })

  return (
    <MasterDrawer
      title={courier ? `Edit ${courier.name}` : 'Add a courier'}
      intro="How a docket goes to the vendor. Picked when the docket is dispatched."
      submitLabel={courier ? 'Save changes' : 'Add courier'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={courier ? 'Codes never change.' : 'e.g. BLUE_DART.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!courier} autoFocus={!courier} />
      </FormField>
      <FormField label="Courier" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Blue Dart" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label className="check">
          <input type="checkbox" {...register('awbNeeded')} />
          Ask for the slip (AWB) number at dispatch
        </label>
        <span className="hint">Untick for a courier with no slip, like "By hand".</span>
      </div>
    </MasterDrawer>
  )
}
