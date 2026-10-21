import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { TimePicker } from '../../../../components/TimePicker'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { fieldSlotFormSchema, type FieldSlotFormValues } from '../schemas'
import type { FieldSlot } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * The time slots the collection and delivery boy is booked for (docs/decisions/0015-field-staff-app.md Decision 2):
 * "11 am – 1 pm", "2–4 pm", "4–6 pm" ⚠️. Shared by every department; the Head or any HOD changes them.
 */
export function FieldSlotsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('field-slots')
  const [editing, setEditing] = useState<FieldSlot | 'new' | null>(null)
  const rows = (list.data ?? []).filter((s) => showInactive || s.isActive)

  return (
    <>
      <ListCard title="Time slots" count={rows.length} addLabel="Add a slot" canEdit={canEdit} onAdd={() => setEditing('new')} query={list} empty="No slots yet.">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Slot</th>
              <th>From – to</th>
              <th>Order</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className={s.isActive ? undefined : 'row-off'}>
                <td className="mono">{s.code}</td>
                <td style={{ fontWeight: 700 }}>{s.name}</td>
                <td className="mono">
                  {s.startsAt} – {s.endsAt}
                </td>
                <td>{s.sortOrder}</td>
                <td>{s.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="field-slots" id={s.id} name={s.name} isActive={s.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <SlotDrawer slot={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SlotDrawer({ slot, onClose }: { slot: FieldSlot | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('field-slots')
  const { register, control, handleSubmit, setError, formState } = useForm<FieldSlotFormValues>({
    resolver: zodResolver(fieldSlotFormSchema),
    defaultValues: {
      code: slot?.code ?? '',
      name: slot?.name ?? '',
      startsAt: slot?.startsAt ?? '',
      endsAt: slot?.endsAt ?? '',
      sortOrder: slot?.sortOrder ?? 0,
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, startsAt: v.startsAt, endsAt: v.endsAt, sortOrder: v.sortOrder }
    save.mutate(slot ? { id: slot.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'startsAt', 'endsAt', 'sortOrder']),
    })
  })

  return (
    <MasterDrawer
      title={slot ? `Edit ${slot.name}` : 'Add a slot'}
      intro="Staff pick it when they book the collection or delivery boy. It shows on his run and to the client."
      submitLabel={slot ? 'Save changes' : 'Add slot'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={slot ? 'Codes never change.' : 'e.g. EVENING.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!slot} autoFocus={!slot} />
      </FormField>
      <FormField label="Slot" error={errors.name?.message} hint="As staff and the boy will see it.">
        <input className="input" {...register('name')} placeholder="4–6 pm" />
      </FormField>
      <FormField label="From" error={errors.startsAt?.message}>
        <Controller
          control={control}
          name="startsAt"
          render={({ field }) => <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} label="Slot from" invalid={!!errors.startsAt} />}
        />
      </FormField>
      <FormField label="To" error={errors.endsAt?.message}>
        <Controller
          control={control}
          name="endsAt"
          render={({ field }) => <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} label="Slot to" invalid={!!errors.endsAt} />}
        />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
