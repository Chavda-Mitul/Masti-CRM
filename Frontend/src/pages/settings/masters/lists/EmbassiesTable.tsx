import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useHolidayTargets, useMasterList, useSaveMaster } from '../queries'
import { embassyFormSchema, type EmbassyFormValues } from '../schemas'
import type { Embassy } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * Embassies, consulates and visa centres where files are submitted ("French embassy, Mumbai"). A holiday can apply to
 * one of them. Every department may need them, so any HOD can change them. The code never changes: the bot uses it.
 */
export function EmbassiesTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('embassies')
  const [countryId, setCountryId] = useState('')
  const [editing, setEditing] = useState<Embassy | 'new' | null>(null)
  const all = list.data ?? []
  const rows = all.filter((e) => (showInactive || e.isActive) && (!countryId || String(e.countryId) === countryId))
  const countries = [...new Map(all.map((e) => [e.countryId, e.country])).values()].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <ListCard
        title="Embassies & visa centres"
        count={rows.length}
        addLabel="Add an embassy"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No embassies here."
        toolbar={
          countries.length > 1 && (
            <select className="select" value={countryId} onChange={(e) => setCountryId(e.target.value)} aria-label="Country" style={{ width: 200, height: 34 }}>
              <option value="">Every country</option>
              {countries.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          )
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Country</th>
              <th>City</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.isActive ? undefined : 'row-off'}>
                <td className="mono">{e.code}</td>
                <td style={{ fontWeight: 700 }}>{e.name}</td>
                <td>{e.country.name}</td>
                <td>{e.city}</td>
                <td>{e.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(e)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="embassies" id={e.id} name={e.name} isActive={e.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <EmbassyDrawer embassy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EmbassyDrawer({ embassy, onClose }: { embassy: Embassy | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('embassies')
  // Active countries come with the holiday targets, which every office user can read (the country list needs Visa).
  const targets = useHolidayTargets()
  const { register, handleSubmit, setError, formState } = useForm<EmbassyFormValues>({
    resolver: zodResolver(embassyFormSchema),
    defaultValues: {
      code: embassy?.code ?? '',
      countryId: embassy ? String(embassy.countryId) : '',
      name: embassy?.name ?? '',
      city: embassy?.city ?? '',
      sortOrder: embassy?.sortOrder ?? 0,
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, city: v.city, sortOrder: v.sortOrder }
    save.mutate(embassy ? { id: embassy.id, body } : { body: { ...body, code: v.code, countryId: Number(v.countryId) } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'countryId', 'name', 'city', 'sortOrder']),
    })
  })

  return (
    <MasterDrawer
      title={embassy ? `Edit ${embassy.name}` : 'Add an embassy or visa centre'}
      intro="A holiday can then apply to this one post, not the whole country."
      submitLabel={embassy ? 'Save changes' : 'Add embassy'}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={embassy ? 'Codes never change.' : 'Country and city, e.g. FR-MUM.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!embassy} autoFocus={!embassy} />
      </FormField>
      <FormField label="Country" error={errors.countryId?.message} hint={embassy ? 'Can’t be changed.' : undefined}>
        {embassy ? (
          <input className="input" value={embassy.country.name} readOnly />
        ) : (
          <select className="select" {...register('countryId')} disabled={!targets.data}>
            <option value="">Pick a country</option>
            {targets.data?.countries.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label="Name" error={errors.name?.message} wide>
        <input className="input" {...register('name')} placeholder="French embassy, Mumbai" />
      </FormField>
      <FormField label="City" error={errors.city?.message}>
        <input className="input" {...register('city')} placeholder="Mumbai" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </MasterDrawer>
  )
}
