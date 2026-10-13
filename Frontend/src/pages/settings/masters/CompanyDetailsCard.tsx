import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useMe } from '../../../auth/useAuth'
import { FormField } from '../../../components/FormField'
import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useCompanyDetails, useUpdateCompanyDetails } from './queries'
import { companyDetailsFormSchema, type CompanyDetailsFormValues } from './schemas'
import type { CompanyDetails } from './types'

/**
 * Masti's own details (Setting row "company.details", docs/decisions/0008-visa-docket-dispatch.md Decision 5): the
 * "From" on the parcel sticker, and later the invoice header. Everyone sees them; only the Head changes them.
 */
export function CompanyDetailsCard() {
  const { data: me } = useMe()
  const details = useCompanyDetails()
  const isHead = me?.type === 'HEAD'

  return (
    <section className="card pad master-card">
      <h2 className="h2">Company details</h2>
      {details.isPending ? (
        <p className="muted">Loading…</p>
      ) : details.isError ? (
        <div className="alert alert-bad">{errorText(details.error)}</div>
      ) : isHead ? (
        <DetailsForm details={details.data} />
      ) : (
        <dl className="kv-list">
          <div>
            <dt>Name</dt>
            <dd>{details.data.name}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{details.data.address}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{details.data.phone}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function DetailsForm({ details }: { details: CompanyDetails }) {
  const toast = useToast()
  const update = useUpdateCompanyDetails()
  const { register, handleSubmit, formState, reset } = useForm<CompanyDetailsFormValues>({
    resolver: zodResolver(companyDetailsFormSchema),
    defaultValues: details,
  })

  const onSubmit = handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: (saved) => {
        reset(saved)
        toast({ tone: 'ok', message: 'Company details saved.' })
      },
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="settings-form">
      <p className="muted small" style={{ margin: 0 }}>
        Printed as “From” on every parcel sticker.
      </p>
      <FormField label="Name" error={formState.errors.name?.message}>
        <input className="input" {...register('name')} />
      </FormField>
      <FormField label="Address" error={formState.errors.address?.message}>
        <textarea className="input textarea" rows={3} {...register('address')} />
      </FormField>
      <FormField label="Phone" error={formState.errors.phone?.message}>
        <input className="input" {...register('phone')} style={{ maxWidth: 220 }} />
      </FormField>
      {update.error && <div className="alert alert-bad">{errorText(update.error)}</div>}
      <div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!formState.isDirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
