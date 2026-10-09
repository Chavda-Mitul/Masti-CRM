import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { visaTypeFormSchema, type VisaTypeFormValues } from '../schemas'
import type { VisaType } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/** Tourist, Business, Student… Combined with a country, each makes a checklist. */
export function VisaTypesTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('visa-types')
  const [editing, setEditing] = useState<VisaType | 'new' | null>(null)
  const rows = (list.data ?? []).filter((t) => showInactive || t.isActive)

  return (
    <>
      <ListCard
        title="Visa types"
        count={rows.length}
        addLabel="Add a visa type"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No visa types yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Visa type</th>
              <th>Order</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.isActive ? undefined : 'row-off'}>
                <td className="mono">{t.code}</td>
                <td style={{ fontWeight: 700 }}>{t.name}</td>
                <td>{t.sortOrder}</td>
                <td>{t.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="visa-types" id={t.id} name={t.name} isActive={t.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <VisaTypeDrawer visaType={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function VisaTypeDrawer({ visaType, onClose }: { visaType: VisaType | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('visa-types')
  const { register, handleSubmit, setError, formState } = useForm<VisaTypeFormValues>({
    resolver: zodResolver(visaTypeFormSchema),
    defaultValues: { code: visaType?.code ?? '', name: visaType?.name ?? '', sortOrder: visaType?.sortOrder ?? 0 },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder }
    save.mutate(visaType ? { id: visaType.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder']),
    })
  })

  return (
    <MasterDrawer
      title={visaType ? `Edit ${visaType.name}` : 'Add a visa type'}
      intro="Then set up a checklist for each country that offers it."
      submitLabel={visaType ? 'Save changes' : 'Add visa type'}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={visaType ? 'Codes never change.' : 'e.g. BUSINESS.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!visaType} autoFocus={!visaType} />
      </FormField>
      <FormField label="Visa type" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Business" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
