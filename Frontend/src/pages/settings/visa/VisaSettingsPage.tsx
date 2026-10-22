import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { InfoButton } from '../../../components/InfoButton'
import { RefreshFailed } from '../../../components/RefreshFailed'
import { TimePicker } from '../../../components/TimePicker'
import { errorBody, errorText, lostAccess } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useSaveVisaSettings, useVisaSettings } from '../masters/queries'
import { visaTimingsFormSchema, type VisaTimingsFormValues } from '../masters/schemas'
import type { VisaSettings } from '../masters/types'
import { type HelpLines, VISA_SETTINGS_HELP as HELP } from './help'

type TimingKey = Exclude<keyof VisaTimingsFormValues, 'collectionCheck' | 'passportValidity' | 'childAge' | 'passportsArrive'>

/** Each check a case comes back due for, in the order a case meets them, with what its days count from. */
const CHECKS: { key: TimingKey; what: string; from: string }[] = [
  { key: 'firstFollowUp', what: 'First follow-up', from: 'after the enquiry is saved' },
  { key: 'assignCheck', what: 'Give a matured case to a processor', from: 'after the documents are marked complete (the HOD’s)' },
  { key: 'dispatchCheck', what: 'Put a ready file in a docket and dispatch it', from: 'after File ready' },
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
  passportsArrive: s.passportsArrive,
}) as VisaTimingsFormValues

const days = (n: number) => `${n} office day${n === 1 ? '' : 's'}`

const TIMINGS = 'When a case comes back due'
const PASSPORT_VALIDITY = 'A passport must still run, after the trip comes back'
const ADULT_FROM = 'A traveller counts as an adult from'
const PASSPORTS_ARRIVE = 'Passports reach our office after the decision'
const workingDays = (n: number) => `${n} working day${n === 1 ? '' : 's'}`

/** The ⓘ next to a setting, with what it's for in plain words (help.ts). */
function Help({ topic, lines }: { topic: string; lines: HelpLines }) {
  return (
    <InfoButton topic={topic}>
      <dl className="info-list">
        {lines.map(([heading, text]) => (
          <div key={heading}>
            <dt>{heading}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </InfoButton>
  )
}

/**
 * Settings → Visa (decided 19 Oct 2026, item 2 fixes): when a visa case comes back due on its processor's desk after each
 * step ⚠️, the two values the input warnings use ⚠️, and the working days the decision message gives the client ⚠️
 * (22 Oct 2026). They were editable only through the API; the Visa HOD or the Head changes them here, Visa staff read
 * them. A change applies to the next save that uses it, not to open cases.
 */
export function VisaSettingsPage() {
  const { data: me } = useMe()
  const settings = useVisaSettings()
  const canEdit = !!me && canEditVisaMasters(me)

  if (settings.isPending) return <p className="muted">Loading…</p>
  if (settings.isLoadingError || lostAccess(settings)) return <div className="alert alert-bad">{errorText(settings.error)}</div>
  return (
    <>
      <RefreshFailed query={settings} what="the settings" />
      {canEdit ? <SettingsForm settings={settings.data} /> : <SettingsView settings={settings.data} />}
    </>
  )
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
        <h2 className="h2">
          {TIMINGS} <Help topic={TIMINGS} lines={HELP.timings} />
        </h2>
        <p className="muted small">
          The case comes back to whoever is handling it on the open office day this many days on (Sundays and office holidays are
          skipped), at this time. A change applies to the next case that reaches the step.
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
                  <strong>{c.what}</strong> <Help topic={c.what} lines={HELP[c.key]} />
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
                <strong>Check the collection with the vendor</strong> <Help topic="Check the collection with the vendor" lines={HELP.collectionCheck} />
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
        {/* A table, not FormFields: an ⓘ inside a field's <label> would open instead of focusing the box. */}
        <table className="table">
          <thead>
            <tr>
              <th>Warning</th>
              <th>Set to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{PASSPORT_VALIDITY}</strong> <Help topic={PASSPORT_VALIDITY} lines={HELP.passportValidity} />
              </td>
              <td>
                <div className="unit-input">
                  <input className="input" type="number" min={0} max={24} style={{ width: 90 }} aria-label={`${PASSPORT_VALIDITY}: months`} {...register('passportValidity.monthsAfterReturn', { valueAsNumber: true })} />
                  <span className="muted small">months</span>
                </div>
                {errors.passportValidity?.monthsAfterReturn && <div className="field-error">{errors.passportValidity.monthsAfterReturn.message}</div>}
              </td>
            </tr>
            <tr>
              <td>
                <strong>{ADULT_FROM}</strong> <Help topic={ADULT_FROM} lines={HELP.childAge} />
              </td>
              <td>
                <div className="unit-input">
                  <input className="input" type="number" min={1} max={25} style={{ width: 90 }} aria-label={`${ADULT_FROM}: years old`} {...register('childAge.adultFrom', { valueAsNumber: true })} />
                  <span className="muted small">years old</span>
                </div>
                {errors.childAge?.adultFrom && <div className="field-error">{errors.childAge.adultFrom.message}</div>}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card pad master-card">
        <h2 className="h2">Client messages</h2>
        <p className="muted small">What the automatic WhatsApp messages tell the client. A change applies to the next message sent.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Message</th>
              <th>Set to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{PASSPORTS_ARRIVE}</strong> <Help topic={PASSPORTS_ARRIVE} lines={HELP.passportsArrive} />
                <div className="muted small">in the decision message</div>
              </td>
              <td>
                <div className="unit-input">
                  <input className="input" type="number" min={1} max={30} style={{ width: 90 }} aria-label={`${PASSPORTS_ARRIVE}: working days`} {...register('passportsArrive.workingDays', { valueAsNumber: true })} />
                  <span className="muted small">working days</span>
                </div>
                {errors.passportsArrive?.workingDays && <div className="field-error">{errors.passportsArrive.workingDays.message}</div>}
              </td>
            </tr>
          </tbody>
        </table>
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
        <h2 className="h2">
          {TIMINGS} <Help topic={TIMINGS} lines={HELP.timings} />
        </h2>
        <dl className="kv-list">
          {CHECKS.map((c) => (
            <div key={c.key}>
              <dt>
                {c.what} <Help topic={c.what} lines={HELP[c.key]} /> <span className="muted small">({c.from})</span>
              </dt>
              <dd>
                {days(s[c.key].afterDays)} on, at {s[c.key].at}
              </dd>
            </div>
          ))}
          <div>
            <dt>
              Check the collection with the vendor <Help topic="Check the collection with the vendor" lines={HELP.collectionCheck} />
            </dt>
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
            <dt>
              {PASSPORT_VALIDITY} <Help topic={PASSPORT_VALIDITY} lines={HELP.passportValidity} />
            </dt>
            <dd>{s.passportValidity.monthsAfterReturn} months</dd>
          </div>
          <div>
            <dt>
              {ADULT_FROM} <Help topic={ADULT_FROM} lines={HELP.childAge} />
            </dt>
            <dd>{s.childAge.adultFrom} years old</dd>
          </div>
        </dl>
      </section>
      <section className="card pad master-card">
        <h2 className="h2">Client messages</h2>
        <dl className="kv-list">
          <div>
            <dt>
              {PASSPORTS_ARRIVE} <Help topic={PASSPORTS_ARRIVE} lines={HELP.passportsArrive} />
            </dt>
            <dd>about {workingDays(s.passportsArrive.workingDays)}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
