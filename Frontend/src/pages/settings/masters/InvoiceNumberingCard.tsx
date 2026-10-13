import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { FormField } from '../../../components/FormField'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useSaveVisaInvoiceSetting, useVisaInvoiceSetting } from './queries'
import { invoiceSettingFormSchema, type InvoiceSettingFormValues } from './schemas'
import type { InvoiceSetting } from './types'

/** "MVI00001379" */
const numberOf = (s: Pick<InvoiceSetting, 'prefix' | 'digits' | 'startAt'>) => `${s.prefix}${String(s.startAt).padStart(s.digits, '0')}`

/**
 * The visa invoice's number series and GST (Setting row "visa.invoice", docs/decisions/0009-visa-invoice.md Decisions 3
 * and 4): Masti's own series continues, so at go-live the starting number follows their last invoice. The Visa HOD or
 * the Head changes it; everyone else reads it.
 */
export function InvoiceNumberingCard() {
  const { data: me } = useMe()
  const setting = useVisaInvoiceSetting()
  const canEdit = !!me && canEditVisaMasters(me)

  return (
    <section className="card pad master-card">
      <h2 className="h2">Invoice numbering &amp; GST</h2>
      {setting.isPending ? (
        <p className="muted">Loading…</p>
      ) : setting.isError ? (
        <div className="alert alert-bad">{errorText(setting.error)}</div>
      ) : canEdit ? (
        <SettingForm setting={setting.data} />
      ) : (
        <dl className="kv-list">
          <div>
            <dt>First invoice number</dt>
            <dd className="mono">{numberOf(setting.data)}</dd>
          </div>
          <div>
            <dt>GST on the service charge</dt>
            <dd>{setting.data.gstRatePercent}%</dd>
          </div>
          <div>
            <dt>SAC</dt>
            <dd className="mono">{setting.data.sac}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function SettingForm({ setting }: { setting: InvoiceSetting }) {
  const toast = useToast()
  const save = useSaveVisaInvoiceSetting()
  const { register, handleSubmit, formState, reset, control } = useForm<InvoiceSettingFormValues>({
    resolver: zodResolver(invoiceSettingFormSchema),
    defaultValues: setting,
  })
  const { errors } = formState
  const [prefix, digits, startAt] = useWatch({ control, name: ['prefix', 'digits', 'startAt'] })
  const preview = /^[A-Za-z]{1,8}$/.test(prefix) && digits >= 4 && digits <= 12 && startAt >= 1 ? numberOf({ prefix: prefix.toUpperCase(), digits, startAt }) : '—'
  const serverIssue = errorBody(save.error)?.issues?.invoice?.[0]

  const onSubmit = handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        reset(saved)
        toast({ tone: 'ok', message: 'Invoice numbering saved.' })
      },
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="settings-form">
      <p className="muted small" style={{ margin: 0 }}>
        Masti’s own series continues. At go-live, set the starting number to follow Masti’s last invoice.
      </p>
      <div className="invoice-number-grid">
        <FormField label="Prefix" error={errors.prefix?.message}>
          <input className="input mono upper" {...register('prefix')} />
        </FormField>
        <FormField label="Digits" error={errors.digits?.message}>
          <input className="input" type="number" min={4} max={12} {...register('digits', { valueAsNumber: true })} />
        </FormField>
        <FormField label="Starting number" error={errors.startAt?.message}>
          <input className="input" type="number" min={1} {...register('startAt', { valueAsNumber: true })} />
        </FormField>
        <FormField label="GST %" error={errors.gstRatePercent?.message} hint="On the service charge only.">
          <input className="input" type="number" min={0} max={28} step="0.01" {...register('gstRatePercent', { valueAsNumber: true })} />
        </FormField>
        <FormField label="SAC" error={errors.sac?.message}>
          <input className="input mono" inputMode="numeric" {...register('sac')} />
        </FormField>
      </div>
      <div className="kv">
        <span>The first invoice will be</span>
        <strong className="mono">{preview}</strong>
      </div>
      {(serverIssue ?? (save.error && errorText(save.error))) && <div className="alert alert-bad">{serverIssue ?? errorText(save.error)}</div>}
      <div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!formState.isDirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
