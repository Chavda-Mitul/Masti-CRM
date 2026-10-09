import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { enquirySourceFormSchema, type EnquirySourceFormValues } from '../schemas'
import type { EnquirySource } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/** "Came in through": the chips on the New enquiry form. Reports count enquiries by these, so no free text. */
export function EnquirySourcesTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('enquiry-sources')
  const [editing, setEditing] = useState<EnquirySource | 'new' | null>(null)
  const rows = (list.data ?? []).filter((s) => showInactive || s.isActive)

  return (
    <>
      <ListCard
        title="Enquiry sources"
        count={rows.length}
        addLabel="Add a source"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No sources yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Came in through</th>
              <th>On the staff form</th>
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
                <td>{s.staffSelectable ? 'Yes' : <span className="muted">No · set by integrations</span>}</td>
                <td>{s.sortOrder}</td>
                <td>{s.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="enquiry-sources" id={s.id} name={s.name} isActive={s.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <EnquirySourceDrawer source={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EnquirySourceDrawer({ source, onClose }: { source: EnquirySource | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('enquiry-sources')
  const { register, handleSubmit, setError, formState } = useForm<EnquirySourceFormValues>({
    resolver: zodResolver(enquirySourceFormSchema),
    defaultValues: {
      code: source?.code ?? '',
      name: source?.name ?? '',
      sortOrder: source?.sortOrder ?? 0,
      staffSelectable: source?.staffSelectable ?? true,
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder, staffSelectable: v.staffSelectable }
    save.mutate(source ? { id: source.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder', 'staffSelectable']),
    })
  })

  return (
    <MasterDrawer
      title={source ? `Edit ${source.name}` : 'Add a source'}
      intro="How a client reached us. Staff pick it on the New enquiry form."
      submitLabel={source ? 'Save changes' : 'Add source'}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={source ? 'Codes never change.' : 'e.g. JUSTDIAL.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!source} autoFocus={!source} />
      </FormField>
      <FormField label="Came in through" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Justdial" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label className="check">
          <input type="checkbox" {...register('staffSelectable')} />
          Staff can pick it on the New enquiry form
        </label>
        <span className="hint">Untick for sources only an integration sets, like a website form.</span>
      </div>
    </MasterDrawer>
  )
}
