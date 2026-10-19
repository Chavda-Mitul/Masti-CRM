import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { FormField } from '../../../components/FormField'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useDocumentRemindersSetting, useSaveDocumentRemindersSetting } from './queries'
import { documentRemindersFormSchema, type DocumentRemindersFormValues } from './schemas'
import type { DocumentRemindersSetting } from './types'

const CHANNELS = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
] as const

/** "Every 2 days at 11:00 on WhatsApp" */
function summary(s: DocumentRemindersSetting) {
  const every = s.everyDays === 1 ? 'Every day' : `Every ${s.everyDays} days`
  return `${every} at ${s.sendAt} on ${CHANNELS.find((c) => c.value === s.channel)?.label ?? s.channel}`
}

/**
 * Reminder rules (demo screen 29): the visa pending-document reminders (Setting row "visa.documentReminders", 0006
 * amendment 19). The Visa HOD or the Head changes them; every open case's next reminder follows at once. Visa staff
 * read them.
 */
export function ReminderRulesCard() {
  const { data: me } = useMe()
  const setting = useDocumentRemindersSetting()
  const canEdit = !!me && canEditVisaMasters(me)

  return (
    <section className="card pad master-card">
      <h2 className="h2">Reminder rules</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Visa documents still missing: the client is reminded, listing only what’s missing, until everything is in. Sending
        starts once WhatsApp is connected.
      </p>
      {setting.isPending ? (
        <p className="muted">Loading…</p>
      ) : setting.isError ? (
        <div className="alert alert-bad">{errorText(setting.error)}</div>
      ) : canEdit ? (
        <SettingForm setting={setting.data} />
      ) : (
        <dl className="kv-list">
          <div>
            <dt>Visa documents</dt>
            <dd>{setting.data.enabled ? summary(setting.data) : 'Off'}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function SettingForm({ setting }: { setting: DocumentRemindersSetting }) {
  const toast = useToast()
  const save = useSaveDocumentRemindersSetting()
  const { register, handleSubmit, formState, reset } = useForm<DocumentRemindersFormValues>({
    resolver: zodResolver(documentRemindersFormSchema),
    defaultValues: setting,
  })
  const { errors } = formState
  const serverIssue = errorBody(save.error)?.issues?.documentReminders?.[0]

  const onSubmit = handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        reset(saved)
        toast({ tone: 'ok', message: 'Reminder rules saved.' })
      },
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="settings-form">
      <label className="check">
        <input type="checkbox" {...register('enabled')} />
        <span>Remind clients about missing visa documents</span>
      </label>
      <div className="reminder-rules-grid">
        <FormField label="Every (days)" error={errors.everyDays?.message}>
          <input className="input" type="number" min={1} max={30} {...register('everyDays', { valueAsNumber: true })} />
        </FormField>
        <FormField label="At" error={errors.sendAt?.message}>
          <input className="input" type="time" {...register('sendAt')} />
        </FormField>
        <FormField label="On" error={errors.channel?.message}>
          <select className="select" {...register('channel')}>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <span className="hint">
        Counted from the day the document list goes out. A Sunday or an office holiday moves a reminder to the next open
        day.
      </span>
      {(serverIssue ?? (save.error && errorText(save.error))) && <div className="alert alert-bad">{serverIssue ?? errorText(save.error)}</div>}
      <div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!formState.isDirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
