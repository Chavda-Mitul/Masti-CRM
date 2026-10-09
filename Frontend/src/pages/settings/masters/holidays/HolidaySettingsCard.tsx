import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useMe } from '../../../../auth/useAuth'
import { FormField } from '../../../../components/FormField'
import { errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useHolidaySettings, useUpdateHolidaySettings } from '../queries'
import { holidaySettingsFormSchema, type HolidaySettingsFormValues } from '../schemas'
import type { HolidaySettings } from '../types'

/** The holiday calendar's two settings (Setting row "holidays"). Everyone sees them; only the Head changes them. */
export function HolidaySettingsCard() {
  const { data: me } = useMe()
  const settings = useHolidaySettings()
  const isHead = me?.type === 'HEAD'

  return (
    <section className="card pad master-card">
      <h2 className="h2">Holiday calendar settings</h2>
      {settings.isPending ? (
        <p className="muted">Loading…</p>
      ) : settings.isError ? (
        <div className="alert alert-bad">{errorText(settings.error)}</div>
      ) : isHead ? (
        <SettingsForm settings={settings.data} />
      ) : (
        <dl className="kv-list">
          <div>
            <dt>“New” chip shows for</dt>
            <dd>{settings.data.newForDays} days</dd>
          </div>
          <div>
            <dt>Bot entries wait for a person</dt>
            <dd>{settings.data.botEntriesNeedReview ? 'Yes' : 'No, they block straight away'}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function SettingsForm({ settings }: { settings: HolidaySettings }) {
  const toast = useToast()
  const update = useUpdateHolidaySettings()
  const { register, handleSubmit, formState, reset } = useForm<HolidaySettingsFormValues>({
    resolver: zodResolver(holidaySettingsFormSchema),
    defaultValues: settings,
  })

  const onSubmit = handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: (saved) => {
        reset(saved)
        toast({ tone: 'ok', message: 'Holiday settings saved.' })
      },
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="settings-form">
      <FormField label="“New” chip shows for (days)" error={formState.errors.newForDays?.message}>
        <input className="input" type="number" min={1} max={90} {...register('newForDays', { valueAsNumber: true })} style={{ maxWidth: 120 }} />
      </FormField>
      <label className="check">
        <input type="checkbox" {...register('botEntriesNeedReview')} />
        <span>
          Holidays from the bot wait for a person to confirm them
          <span className="hint" style={{ display: 'block' }}>
            Off: they block dates as soon as they arrive.
          </span>
        </span>
      </label>
      {update.error && <div className="alert alert-bad">{errorText(update.error)}</div>}
      <div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!formState.isDirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
