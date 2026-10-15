import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { FormField, RequiredMark } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { formatMobile } from '../../../../lib/format'
import { filtered, mobileChars } from '../../../../lib/inputFilters'
import { useToast } from '../../../../lib/toast'
import { orNull } from '../forms'
import { useMasterList, useSaveMaster } from '../queries'
import { vendorFormSchema, type VendorFormValues } from '../schemas'
import type { Vendor } from '../types'
import { CountryPicker } from './CountryPicker'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * Visa submission agents and the countries they cover ("Mumbai · Schengen"), docs/decisions/0007-visa-file-prep.md
 * Decision 7. Only the Visa HOD or the Head adds one, and adding approves it. Staff can only pick active vendors.
 */
export function VendorsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('vendors')
  const [countryId, setCountryId] = useState('')
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null)
  const all = list.data ?? []
  const rows = all.filter((v) => (showInactive || v.isActive) && (!countryId || v.countries.some((c) => String(c.id) === countryId)))
  const countries = [...new Map(all.flatMap((v) => v.countries).map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <ListCard
        title="Vendors"
        count={rows.length}
        addLabel="Add a vendor"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No vendors here."
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
              <th>Name</th>
              <th>City</th>
              <th>Countries</th>
              <th>Contact</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className={v.isActive ? undefined : 'row-off'}>
                <td style={{ fontWeight: 700 }}>{v.name}</td>
                <td>{v.city}</td>
                <td>{v.countries.map((c) => c.name).join(', ')}</td>
                <td className="small">
                  {v.contactName && <div>{v.contactName}</div>}
                  {v.mobile && <div className="mono">{formatMobile(v.mobile)}</div>}
                  <div className="muted">{v.email}</div>
                </td>
                <td>{v.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(v)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="vendors" id={v.id} name={v.name} isActive={v.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <VendorDrawer vendor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function VendorDrawer({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('vendors')
  const countryList = useMasterList('countries')
  const active = (countryList.data ?? []).filter((c) => c.isActive)
  // Countries this vendor covers that were switched off since: kept, and shown as such.
  const extra = (vendor?.countries ?? []).filter((c) => !active.some((a) => a.id === c.id))
  const { register, control, handleSubmit, setError, formState } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: {
      name: vendor?.name ?? '',
      city: vendor?.city ?? '',
      countryIds: vendor?.countries.map((c) => String(c.id)) ?? [],
      contactName: vendor?.contactName ?? '',
      mobile: vendor?.mobile ? formatMobile(vendor.mobile) : '',
      email: vendor?.email ?? '',
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = {
      name: v.name,
      city: v.city,
      countryIds: v.countryIds.map(Number),
      contactName: orNull(v.contactName),
      mobile: orNull(v.mobile),
      email: v.email.trim(),
    }
    save.mutate(vendor ? { id: vendor.id, body } : { body }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['name', 'city', 'countryIds', 'contactName', 'mobile', 'email']),
    })
  })

  return (
    <MasterDrawer
      title={vendor ? `Edit ${vendor.name}` : 'Add a vendor'}
      intro="A visa submission agent. Adding it approves it: staff can then pick it on files for the countries it covers."
      submitLabel={vendor ? 'Save changes' : 'Add vendor'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Name" error={errors.name?.message} required wide>
        <input className="input" {...register('name')} placeholder="Global Visa Services" autoFocus={!vendor} aria-required />
      </FormField>
      <FormField label="City" error={errors.city?.message} required>
        <input className="input" {...register('city')} placeholder="Mumbai" aria-required />
      </FormField>

      {/* Not a FormField: that is a <label>, and the picker holds its own inputs. */}
      <div className={`field${errors.countryIds ? ' field-invalid' : ''}`} style={{ gridColumn: '1 / -1' }}>
        <span>
          Countries covered
          <RequiredMark />
        </span>
        <Controller
          control={control}
          name="countryIds"
          render={({ field }) => (
            <CountryPicker value={field.value} onChange={field.onChange} countries={active} extra={extra} invalid={!!errors.countryIds} />
          )}
        />
        {errors.countryIds?.message ? (
          <span className="field-error" role="alert">
            {errors.countryIds.message}
          </span>
        ) : (
          <span className="hint">Its files can be sent only for these countries.</span>
        )}
      </div>

      <FormField label="Contact person" error={errors.contactName?.message} wide>
        <input className="input" {...register('contactName')} placeholder="optional" />
      </FormField>
      <FormField label="Mobile" error={errors.mobile?.message}>
        <input className="input mono" {...filtered(register('mobile'), mobileChars)} placeholder="98250 41234" inputMode="tel" />
      </FormField>
      <FormField label="Email" error={errors.email?.message} hint="The dispatch email goes here (Step 4)." required>
        <input className="input" type="email" {...register('email')} placeholder="name@company.com" aria-required />
      </FormField>
    </MasterDrawer>
  )
}
