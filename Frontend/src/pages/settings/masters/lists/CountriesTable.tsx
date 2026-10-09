import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { countryFormSchema, type CountryFormValues } from '../schemas'
import type { Country } from '../types'
import { orNull } from '../forms'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'
import { ListCard } from './ListCard'

/** Countries we process visas for. The code (ISO, e.g. FR) never changes: the holiday bot uses it. */
export function CountriesTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('countries')
  const [editing, setEditing] = useState<Country | 'new' | null>(null)
  const rows = (list.data ?? []).filter((c) => showInactive || c.isActive)

  return (
    <>
    <ListCard
      title="Countries"
      count={rows.length}
      addLabel="Add a country"
      canEdit={canEdit}
      onAdd={() => setEditing('new')}
      query={list}
      empty="No countries yet."
    >
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Country</th>
            <th>Zone</th>
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
              <td>{c.zone ?? <span className="muted">—</span>}</td>
              <td>{c.sortOrder}</td>
              <td>{c.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
              {canEdit && (
                <td>
                  <div className="row-actions">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    <ToggleActiveButton resource="countries" id={c.id} name={c.name} isActive={c.isActive} />
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ListCard>
    {editing && <CountryDrawer country={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CountryDrawer({ country, onClose }: { country: Country | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('countries')
  const { register, handleSubmit, setError, formState } = useForm<CountryFormValues>({
    resolver: zodResolver(countryFormSchema),
    defaultValues: { code: country?.code ?? '', name: country?.name ?? '', zone: country?.zone ?? '', sortOrder: country?.sortOrder ?? 0 },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, zone: orNull(v.zone), sortOrder: v.sortOrder }
    save.mutate(
      country ? { id: country.id, body } : { body: { ...body, code: v.code } },
      {
        onSuccess: (saved) => {
          toast({ tone: 'ok', message: `${saved.name} saved.` })
          onClose()
        },
        onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'zone', 'sortOrder']),
      },
    )
  })

  return (
    <MasterDrawer
      title={country ? `Edit ${country.name}` : 'Add a country'}
      intro="The zone shows in brackets: “France (Schengen)”."
      submitLabel={country ? 'Save changes' : 'Add country'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={country ? 'Codes never change.' : '2 letters (ISO), e.g. FR.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!country} maxLength={2} autoFocus={!country} />
      </FormField>
      <FormField label="Country" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="France" />
      </FormField>
      <FormField label="Zone (optional)" error={errors.zone?.message}>
        <input className="input" {...register('zone')} placeholder="Schengen" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
