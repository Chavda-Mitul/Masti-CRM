import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { FormField } from '../../../components/FormField'
import { TimePicker } from '../../../components/TimePicker'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useSaveVisaSettings, useVisaSettings } from '../masters/queries'
import { visaTimingsFormSchema, type VisaTimingsFormValues } from '../masters/schemas'
import type { VisaSettings } from '../masters/types'

type TimingKey = Exclude<keyof VisaTimingsFormValues, 'collectionCheck' | 'passportValidity' | 'childAge'>

/** Each check a case comes back due for, in the order a case meets them, with what its days count from. */
const CHECKS: { key: TimingKey; what: string; from: string }[] = [
  { key: 'firstFollowUp', what: 'First follow-up', from: 'after the enquiry is saved' },
  { key: 'assignCheck', what: 'Give a matured case to a processor', from: 'after the documents are marked complete (the HOD’s)' },
  { key: 'vendorConfirm', what: 'Did the vendor get the docket?', from: 'after dispatch' },
  { key: 'onlineCheck', what: 'Check the e-visa portal', from: 'after Submitted online' },
  { key: 'submissionCheck', what: 'Get the file number from the vendor', from: 'after Vendor got it, when no appointment is still to come' },
  { key: 'recallReturn', what: 'Chase a recalled file’s papers', from: 'after the recall' },
  { key: 'passportsBackCheck', what: 'Are the passports on their way back?', from: 'after the decision' },
  { key: 'arrivalCheck', what: 'Have the passports arrived?', from: 'after the day they’re expected' },
  { key: 'handoverCheck', what: 'Arrange the handover', from: 'after the passports are received' },
]

/** The form's part of the settings (everything here but the invoice series, which is on Company & invoice). */
const formValues = (s: VisaSettings): VisaTimingsFormValues => ({
  ...Object.fromEntries(CHECKS.map((c) => [c.key, s[c.key]])),
  collectionCheck: s.collectionCheck,
  passportValidity: s.passportValidity,
  childAge: s.childAge,
}) as VisaTimingsFormValues

const days = (n: number) => `${n} office day${n === 1 ? '' : 's'}`

/**
 * Settings → Visa (decided 19 Oct 2026, item 2 fixes): when a visa case comes back due on its processor's desk after each
 * step ⚠️, and the two values the input warnings use ⚠️. They were editable only through the API; the Visa HOD or the
 * Head changes them here, Visa staff read them. A change applies to the next save that uses it, not to open cases.
 */
export function VisaSettingsPage() {
  const { data: me } = useMe()
  const settings = useVisaSettings()
  const canEdit = !!me && canEditVisaMasters(me)

  if (settings.isPending) return <p className="muted">Loading…</p>
  if (settings.isError) return <div className="alert alert-bad">{errorText(settings.error)}</div>
  return canEdit ? <SettingsForm settings={settings.data} /> : <SettingsView settings={settings.data} />
}

function SettingsForm({ settings }: { settings: VisaSettings }) {
  const toast = useToast()
  const save = useSaveVisaSettings()
  const { register, control, handleSubmit, formState, reset } = useForm<VisaTimingsFormValues>({
    resolver: zodResolver(visaTimingsFormSchema),
    defaultValues: formValues(settings),
  })
  const { errors } = formState
  const serverIssue = Object.values(errorBody(save.error)?.issues ?? {}).find((m) => m?.[0])?.[0]

  const onSubmit = handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        reset(formValues(saved))
        toast({ tone: 'ok', message: 'Visa settings saved. They apply from the next save that uses them.' })
      },
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="visa-settings">
      <section className="card pad master-card">
        <h2 className="h2">When a case comes back due</h2>
        <p className="muted small">
          The case comes back to its processor on the open office day this many days on (Sundays and office holidays are skipped), at
          this time. A change applies to the next case that reaches the step.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Office days</th>
              <th>At</th>
            </tr>
          </thead>
          <tbody>
            {CHECKS.map((c) => (
              <tr key={c.key}>
                <td>
                  <strong>{c.what}</strong>
                  <div className="muted small">{c.from}</div>
                </td>
                <td>
                  <input className="input" type="number" min={0} max={30} style={{ width: 90 }} aria-label={`${c.what}: office days`} {...register(`${c.key}.afterDays`, { valueAsNumber: true })} />
                  {errors[c.key]?.afterDays && <div className="field-error">{errors[c.key]?.afterDays?.message}</div>}
                </td>
                <td>
                  <Controller
                    control={control}
                    name={`${c.key}.at`}
                    render={({ field }) => (
                      <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} label={`${c.what}: at`} invalid={!!errors[c.key]?.at} style={{ width: 132 }} />
                    )}
                  />
                  {errors[c.key]?.at && <div className="field-error">{errors[c.key]?.at?.message}</div>}
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Check the collection with the vendor</strong>
                <div className="muted small">office days before the expected collection date</div>
              </td>
              <td>
                <input className="input" type="number" min={0} max={30} style={{ width: 90 }} aria-label="Collection reminder: office days before" {...register('collectionCheck.daysBefore', { valueAsNumber: true })} />
                {errors.collectionCheck?.daysBefore && <div className="field-error">{errors.collectionCheck.daysBefore.message}</div>}
              </td>
              <td>
                <Controller
                  control={control}
                  name="collectionCheck.at"
                  render={({ field }) => (
                    <TimePicker ref={field.ref} value={field.value} onChange={field.onChange} label="Collection reminder: at" invalid={!!errors.collectionCheck?.at} style={{ width: 132 }} />
                  )}
                />
                {errors.collectionCheck?.at && <div className="field-error">{errors.collectionCheck.at.message}</div>}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card pad master-card">
        <h2 className="h2">Warnings</h2>
        <p className="muted small">
          Staff see “Check before saving” and can save anyway; the confirmation is recorded. These two values decide when.
        </p>
        <div className="form-grid">
          <FormField label="A passport must still run, after the trip comes back" hint="months" error={errors.passportValidity?.monthsAfterReturn?.message}>
            <input className="input" type="number" min={0} max={24} style={{ width: 90 }} {...register('passportValidity.monthsAfterReturn', { valueAsNumber: true })} />
          </FormField>
          <FormField label="A traveller counts as an adult from" hint="years old" error={errors.childAge?.adultFrom?.message}>
            <input className="input" type="number" min={1} max={25} style={{ width: 90 }} {...register('childAge.adultFrom', { valueAsNumber: true })} />
          </FormField>
        </div>
      </section>

      {(serverIssue ?? (save.error && errorText(save.error))) && <div className="alert alert-bad">{serverIssue ?? errorText(save.error)}</div>}
      <div>
        <button type="submit" className="btn btn-primary" disabled={!formState.isDirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

/** For Visa staff: the same values, to read. */
function SettingsView({ settings: s }: { settings: VisaSettings }) {
  return (
    <div className="visa-settings">
      <section className="card pad master-card">
        <h2 className="h2">When a case comes back due</h2>
        <dl className="kv-list">
          {CHECKS.map((c) => (
            <div key={c.key}>
              <dt>
                {c.what} <span className="muted small">({c.from})</span>
              </dt>
              <dd>
                {days(s[c.key].afterDays)} on, at {s[c.key].at}
              </dd>
            </div>
          ))}
          <div>
            <dt>Check the collection with the vendor</dt>
            <dd>
              {days(s.collectionCheck.daysBefore)} before, at {s.collectionCheck.at}
            </dd>
          </div>
        </dl>
      </section>
      <section className="card pad master-card">
        <h2 className="h2">Warnings</h2>
        <dl className="kv-list">
          <div>
            <dt>A passport must still run, after the trip comes back</dt>
            <dd>{s.passportValidity.monthsAfterReturn} months</dd>
          </div>
          <div>
            <dt>A traveller counts as an adult from</dt>
            <dd>{s.childAge.adultFrom} years old</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
