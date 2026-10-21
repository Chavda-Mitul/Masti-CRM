import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useMe } from '../../auth/useAuth'
import { FormField } from '../../components/FormField'
import { TimePicker } from '../../components/TimePicker'
import { errorText } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { useTodaySettings, useUpdateTodaySettings } from './queries'
import { todaySettingsFormSchema, type TodaySettingsFormValues } from './schemas'
import type { TodaySettings } from './types'

/** The Today page's setting (Setting row "today", 0017 Decision 3). Everyone sees it; only the Head changes it. */
export function TodaySettingsCard() {
  const { data: me } = useMe()
  const settings = useTodaySettings()
  const isHead = me?.type === 'HEAD'

  return (
    <section className="card pad master-card">
      <h2 className="h2">Today page</h2>
      {settings.isPending ? (
        <p className="muted">Loading…</p>
      ) : settings.isError ? (
        <div className="alert alert-bad">{errorText(settings.error)}</div>
      ) : isHead ? (
        <SettingsForm settings={settings.data} />
      ) : (
        <dl className="kv-list">
          <div>
            <dt>New enquiries count from</dt>
            <dd>{settings.data.newSinceAt} on the previous office day</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function SettingsForm({ settings }: { settings: TodaySettings }) {
  const toast = useToast()
  const update = useUpdateTodaySettings()
  const { control, handleSubmit, formState, reset } = useForm<TodaySettingsFormValues>({
    resolver: zodResolver(todaySettingsFormSchema),
    defaultValues: settings,
  })

  const onSubmit = handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: (saved) => {
        reset(saved)
        toast({ tone: 'ok', message: 'Today page settings saved.' })
      },
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="settings-form">
      <FormField
        label="New enquiries count from"
        error={formState.errors.newSinceAt?.message}
        hint="This time on the previous office day (Sundays and office holidays are skipped): the demo's “since yesterday evening”."
      >
        <Controller
          control={control}
          name="newSinceAt"
          render={({ field }) => (
            <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} label="New enquiries count from" invalid={!!formState.errors.newSinceAt} style={{ maxWidth: 140 }} />
          )}
        />
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
