import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { canEditAccountsFields } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { FormField } from '../../components/FormField'
import { applyServerIssues, errorText, existingClientId, isStale } from './apiErrors'
import { changedIn, clientBody, clientFormDefaults, filledIn } from './forms'
import { useCreateClient, useUpdateClient } from './queries'
import { clientFormSchema, normaliseMobile, type ClientFormValues } from './schemas'
import type { ClientFieldsBody, ClientOptions, ClientProfile } from './types'
import { useDuplicateGuard } from './useDuplicateGuard'

/**
 * Add a client (only the mobile is needed) or edit one's details.
 * Editing sends only changed fields with the updatedAt it loaded (optimistic locking).
 * Accounting code, billing cycle and payment habit are read-only unless the user is in Accounts (or Head).
 */
export function ClientFormDrawer({
  client,
  options,
  onClose,
  onSaved,
}: {
  client: ClientProfile | null
  options: ClientOptions
  onClose: () => void
  onSaved: (client: ClientProfile) => void
}) {
  const { data: me } = useMe()
  const canEditAccounts = me ? canEditAccountsFields(me) : false
  const isNew = client === null

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: clientFormDefaults(client, options),
  })
  const { register, handleSubmit, control, setError, formState } = form
  const { errors } = formState
  const kind = useWatch({ control, name: 'kind' })

  const create = useCreateClient()
  const update = useUpdateClient(client?.id ?? '')
  const save = isNew ? create : update
  const guard = useDuplicateGuard()

  const onError = (error: unknown, retry: () => void) => {
    if (guard.intercept(error, retry)) return
    if (isStale(error)) return onClose()
    applyServerIssues(error, setError, Object.keys(form.getValues()))
  }

  const send = (body: ClientFieldsBody, mobile: string) => {
    if (isNew) {
      create.mutate(
        { ...body, mobile },
        { onSuccess: onSaved, onError: (err) => onError(err, () => send({ ...body, confirmDuplicates: true }, mobile)) },
      )
    } else {
      update.mutate(
        { ...body, updatedAt: client.updatedAt },
        { onSuccess: onSaved, onError: (err) => onError(err, () => send({ ...body, confirmDuplicates: true }, mobile)) },
      )
    }
  }

  const onSubmit = handleSubmit((values) => {
    const include = isNew ? filledIn(values) : changedIn<ClientFormValues>(formState.dirtyFields)
    const body = clientBody(values, include, canEditAccounts)
    if (!isNew && Object.keys(body).length === 0) return onClose()
    send(body, normaliseMobile(values.mobile) ?? values.mobile)
  })

  const existingId = existingClientId(save.error)
  const message = existingId ? null : errorText(save.error)
  const habit = options.paymentHabits.find((h) => String(h.id) === form.getValues('paymentHabitId'))
  const cycle = options.billingCycles.find((c) => String(c.id) === form.getValues('billingCycleId'))

  return (
    <>
      <div className="overlay" onClick={onClose}>
        <form className="drawer drawer-wide" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} noValidate>
          <div className="pad drawer-head">
            <h2 className="h2">{isNew ? 'Add a client' : `Edit ${client.name ?? 'client'}`}</h2>
            <p className="muted">
              {isNew
                ? 'Only the mobile number is needed now. The rest can be completed before invoicing.'
                : 'Only what you change is saved.'}
            </p>
          </div>

          <div className="pad drawer-body">
            <div className="kind-toggle" role="radiogroup" aria-label="Kind of client">
              <label className={kind === 'INDIVIDUAL' ? 'on' : ''}>
                <input type="radio" value="INDIVIDUAL" {...register('kind')} className="sr-only" />
                Person / family
              </label>
              <label className={kind === 'CORPORATE' ? 'on' : ''}>
                <input type="radio" value="CORPORATE" {...register('kind')} className="sr-only" />
                Company
              </label>
            </div>

            <div className="form-grid">
              {isNew ? (
                <FormField label="Mobile number" error={errors.mobile?.message} hint="The main number: client lookup and WhatsApp.">
                  <input className="input mono" {...register('mobile')} placeholder="98250 41234" autoFocus inputMode="tel" />
                </FormField>
              ) : (
                <FormField label="Mobile number" hint="Change it from the Numbers card.">
                  <input className="input mono" value={form.getValues('mobile')} readOnly disabled />
                </FormField>
              )}
              <FormField label={kind === 'CORPORATE' ? 'Company name' : 'Name'} error={errors.name?.message}>
                <input className="input" {...register('name')} placeholder={kind === 'CORPORATE' ? 'Shree Textiles Pvt Ltd' : 'Rajesh Patel'} />
              </FormField>
              {kind === 'CORPORATE' && (
                <FormField label="Contact person" error={errors.contactPerson?.message} hint="The person we deal with.">
                  <input className="input" {...register('contactPerson')} placeholder="Rajesh Patel" />
                </FormField>
              )}
              <FormField label="Email" error={errors.email?.message}>
                <input className="input" type="email" {...register('email')} placeholder="optional" />
              </FormField>
            </div>

            <span className="lbl section-lbl">Address</span>
            <div className="form-grid">
              <FormField label="Address" error={errors.addressLine?.message} wide>
                <input className="input" {...register('addressLine')} placeholder="Building, street" />
              </FormField>
              <FormField label="Area" error={errors.area?.message}>
                <input className="input" {...register('area')} placeholder="Vesu" />
              </FormField>
              <FormField label="City" error={errors.city?.message}>
                <input className="input" {...register('city')} placeholder="Surat" />
              </FormField>
              <FormField label="State" error={errors.stateCode?.message} hint="Sets GST on invoices. Filled from the GSTIN if empty.">
                <select className="select" {...register('stateCode')}>
                  <option value="">Not set</option>
                  {options.states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="PIN code" error={errors.pincode?.message}>
                <input className="input mono" {...register('pincode')} placeholder="395007" inputMode="numeric" maxLength={6} />
              </FormField>
            </div>

            <span className="lbl section-lbl">Tax</span>
            <div className="form-grid">
              <FormField label="PAN" error={errors.pan?.message} hint="Filled from the GSTIN if empty.">
                <input className="input mono upper" {...register('pan')} placeholder="ABCDE1234F" maxLength={12} />
              </FormField>
              <FormField label="GSTIN" error={errors.gstin?.message} hint="Companies, or anyone registered for GST.">
                <input className="input mono upper" {...register('gstin')} placeholder="24ABCDE1234F1Z5" maxLength={17} />
              </FormField>
            </div>

            <span className="lbl section-lbl">Accounts</span>
            {!canEditAccounts && <span className="hint">Only Accounts can change these.</span>}
            <div className="form-grid">
              <FormField label="Code in accounting software" error={errors.accountingCode?.message}>
                {canEditAccounts ? (
                  <input className="input mono" {...register('accountingCode')} placeholder="MT-0142" />
                ) : (
                  <input className="input mono" value={form.getValues('accountingCode') || 'Not set'} readOnly disabled />
                )}
              </FormField>
              <FormField label="Billing cycle" error={errors.billingCycleId?.message}>
                {canEditAccounts ? (
                  <select className="select" {...register('billingCycleId')}>
                    {options.billingCycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" value={cycle?.name ?? 'Default'} readOnly disabled />
                )}
              </FormField>
              <FormField label="Pays" error={errors.paymentHabitId?.message}>
                {canEditAccounts ? (
                  <select className="select" {...register('paymentHabitId')}>
                    <option value="">Not set</option>
                    {options.paymentHabits.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" value={habit?.name ?? 'Not set'} readOnly disabled />
                )}
              </FormField>
            </div>

            {existingId && (
              <div className="alert alert-bad" role="alert">
                A client with this mobile number already exists. <Link to={`/clients/${existingId}`}>Open that client</Link>
              </div>
            )}
            {message && (
              <div className="alert alert-bad" role="alert">
                {message}
              </div>
            )}
          </div>

          <div className="pad drawer-foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : isNew ? 'Add client' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
      {/* Outside the overlay, so clicks in the warning don't reach the drawer's close-on-click. */}
      {guard.modal}
    </>
  )
}
