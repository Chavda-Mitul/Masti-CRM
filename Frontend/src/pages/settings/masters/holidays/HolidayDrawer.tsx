import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { useDrawerGuard } from '../../../../components/useDrawerGuard'
import { ApiError } from '../../../../lib/api'
import { applyServerIssues, errorBody, errorText, isDuplicateWarning, isStale } from '../../../../lib/apiErrors'
import { istToday } from '../../../../lib/format'
import { useToast } from '../../../../lib/toast'
import { useRetryGuard } from '../../../../lib/useRetryGuard'
import { countryKey, embassyKey } from '../forms'
import { useSaveHoliday } from '../queries'
import { holidayFormSchema, type HolidayFormValues, type HolidayWhen } from '../schemas'
import type { Holiday, HolidayBody, HolidayDuplicate, HolidayTargetBody, HolidayTargetOptions } from '../types'
import { HolidayDuplicateModal } from './HolidayDuplicateModal'
import { TargetPicker } from './TargetPicker'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const WHEN_LABEL: Record<HolidayWhen, string> = { DAY: 'One day', RANGE: 'Several days', WEEKLY: 'Every week' }

function targetKeyOf(t: Holiday['targets'][number]): string {
  if (t.kind === 'COUNTRY' && t.country) return countryKey(t.country.id)
  if (t.kind === 'EMBASSY' && t.embassy) return embassyKey(t.embassy.id)
  return t.kind
}

function targetBody(key: string): HolidayTargetBody {
  const [kind, id] = key.split(':')
  if (kind === 'COUNTRY') return { kind, countryId: Number(id) }
  if (kind === 'EMBASSY') return { kind, embassyId: Number(id) }
  return { kind: kind === 'MASTI_OFFICE' ? 'MASTI_OFFICE' : 'ALL_EMBASSIES' }
}

function formDefaults(holiday: Holiday | null): HolidayFormValues {
  if (!holiday) {
    return { name: '', when: 'DAY', startDate: '', endDate: '', weekday: '', targets: [], reference: '' }
  }
  const when: HolidayWhen = holiday.repeat === 'WEEKLY' ? 'WEEKLY' : holiday.startDate === holiday.endDate ? 'DAY' : 'RANGE'
  return {
    name: holiday.name,
    when,
    startDate: holiday.startDate,
    endDate: when === 'DAY' ? '' : (holiday.endDate ?? ''),
    weekday: holiday.weekday ? String(holiday.weekday) : '',
    targets: holiday.targets.map(targetKeyOf),
    reference: holiday.reference ?? '',
  }
}

function toBody(v: HolidayFormValues): HolidayBody {
  const dates =
    v.when === 'WEEKLY'
      ? { repeat: 'WEEKLY' as const, startDate: v.startDate || istToday(), endDate: v.endDate || null, weekday: Number(v.weekday) }
      : { repeat: 'NONE' as const, startDate: v.startDate, endDate: v.when === 'DAY' ? v.startDate : v.endDate, weekday: null }
  return { name: v.name.trim(), ...dates, targets: v.targets.map(targetBody), reference: v.reference.trim() || null }
}

function readHolidayDuplicates(error: unknown): { message: string; matches: HolidayDuplicate[] } | null {
  if (!(error instanceof ApiError) || !isDuplicateWarning(error)) return null
  return { message: error.message, matches: (errorBody(error)?.details?.matches as HolidayDuplicate[] | undefined) ?? [] }
}

/**
 * Add a holiday, or edit one. A probable duplicate is a warning (save anyway); a save over someone else's change is
 * refused (optimistic locking).
 */
export function HolidayDrawer({
  holiday,
  options,
  onClose,
}: {
  holiday: Holiday | null
  options: HolidayTargetOptions
  onClose: () => void
}) {
  const toast = useToast()
  const isNew = holiday === null
  // The version this form was opened on (see ClientFormDrawer): a background refetch must not hide a conflict.
  const [openedAt] = useState(holiday?.updatedAt)

  const form = useForm<HolidayFormValues>({ resolver: zodResolver(holidayFormSchema), defaultValues: formDefaults(holiday) })
  const { register, handleSubmit, control, setError, formState } = form
  const { errors } = formState
  const when = useWatch({ control, name: 'when' })

  const save = useSaveHoliday()
  const guard = useRetryGuard(readHolidayDuplicates, (found, { cancel, confirm }) => (
    <HolidayDuplicateModal message={found.message} matches={found.matches} onCancel={cancel} onConfirm={confirm} />
  ))
  const drawer = useDrawerGuard(formState.isDirty, onClose)

  // Targets on this holiday that the picker no longer offers (switched off since), so they stay visible.
  const offered = new Set([
    'ALL_EMBASSIES',
    'MASTI_OFFICE',
    ...options.countries.flatMap((c) => [countryKey(c.id), ...c.embassies.map((e) => embassyKey(e.id))]),
  ])
  const extra = (holiday?.targets ?? []).filter((t) => !offered.has(targetKeyOf(t))).map((t) => ({ key: targetKeyOf(t), label: t.label }))

  const send = (body: HolidayBody) => {
    save.mutate(
      { ...(holiday ? { id: holiday.id } : {}), body: holiday ? { ...body, updatedAt: openedAt ?? holiday.updatedAt } : body },
      {
        onSuccess: (saved) => {
          toast({ tone: 'ok', message: isNew ? `${saved.name} added to the calendar.` : `${saved.name} saved.` })
          drawer.release()
          onClose()
        },
        onError: (error) => {
          if (guard.intercept(error, () => send({ ...body, confirmDuplicates: true }))) return
          if (isStale(error)) return onClose()
          applyServerIssues(error, setError, ['name', 'startDate', 'endDate', 'weekday', 'targets', 'reference'])
        },
      },
    )
  }

  const onSubmit = handleSubmit((values) => send(toBody(values)))
  const message = errorText(save.error)

  return (
    <>
      <div className="overlay" {...drawer.overlayProps}>
        <form className="drawer drawer-wide" onSubmit={onSubmit} noValidate>
          <div className="pad drawer-head">
            <h2 className="h2">{isNew ? 'Add a holiday' : `Edit ${holiday.name}`}</h2>
            <p className="muted">
              {isNew ? 'It blocks those dates straight away: they can’t be picked as collection dates.' : 'Changes apply straight away.'}
            </p>
          </div>

          <div className="pad drawer-body">
            <FormField label="Holiday" error={errors.name?.message}>
              <input className="input" {...register('name')} placeholder="Dussehra" autoFocus={isNew} />
            </FormField>

            <span className="lbl section-lbl">When</span>
            <div className="kind-toggle" role="radiogroup" aria-label="When">
              {(['DAY', 'RANGE', 'WEEKLY'] as const).map((value) => (
                <label key={value} className={when === value ? 'on' : ''}>
                  <input type="radio" value={value} {...register('when')} className="sr-only" />
                  {WHEN_LABEL[value]}
                </label>
              ))}
            </div>
            <div className="form-grid">
              {when === 'WEEKLY' ? (
                <>
                  <FormField label="Day of the week" error={errors.weekday?.message}>
                    <select className="select" {...register('weekday')}>
                      <option value="">Pick a day</option>
                      {WEEKDAYS.map((day, i) => (
                        <option key={day} value={String(i + 1)}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <span />
                  <FormField label="From (optional)" error={errors.startDate?.message} hint="Leave empty to start today.">
                    <input className="input" type="date" {...register('startDate')} />
                  </FormField>
                  <FormField label="Until (optional)" error={errors.endDate?.message} hint="Leave empty for every week from now on.">
                    <input className="input" type="date" {...register('endDate')} />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label={when === 'DAY' ? 'Date' : 'First day'} error={errors.startDate?.message}>
                    <input className="input" type="date" {...register('startDate')} min={isNew ? istToday() : undefined} />
                  </FormField>
                  {when === 'RANGE' ? (
                    <FormField label="Last day" error={errors.endDate?.message}>
                      <input className="input" type="date" {...register('endDate')} />
                    </FormField>
                  ) : (
                    <span />
                  )}
                </>
              )}
            </div>

            <span className="lbl section-lbl">Applies to</span>
            {errors.targets?.message && (
              <span className="field-error" role="alert">
                {errors.targets.message}
              </span>
            )}
            <Controller
              control={control}
              name="targets"
              render={({ field }) => <TargetPicker value={field.value} onChange={field.onChange} options={options} extra={extra} />}
            />

            <FormField label="Where it was announced (optional)" error={errors.reference?.message} hint="e.g. IVS, or the embassy's notice link.">
              <input className="input" {...register('reference')} placeholder="IVS" />
            </FormField>

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
              {save.isPending ? 'Saving…' : isNew ? 'Add holiday' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
      {guard.modal}
      {drawer.dialog}
    </>
  )
}
