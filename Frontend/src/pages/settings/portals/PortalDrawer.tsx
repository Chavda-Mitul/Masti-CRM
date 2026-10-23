import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FormField } from '../../../components/FormField'
import { PasswordInput } from '../../../components/PasswordInput'
import { useDrawerGuard } from '../../../components/useDrawerGuard'
import { applyServerIssues, errorText, isStale } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { lockedNote, SCHEDULE_CHOICES } from './labels'
import { usePortalPeople, useSavePortal } from './queries'
import { portalFormSchema, stepsFromText, type PortalFormValues } from './schemas'
import type { Portal, PortalBody } from './types'

const FIELDS = ['departmentCode', 'name', 'loginUrl', 'idLabel', 'extraLabel', 'extra', 'loginId', 'password', 'passwordSchedule', 'userIds'] as const

function formDefaults(portal: Portal | null, departmentCode: string): PortalFormValues {
  if (!portal) {
    return {
      departmentCode,
      name: '',
      loginUrl: '',
      idLabel: 'ID',
      hasExtra: false,
      extraLabel: '',
      changeExtra: true,
      extra: '',
      stepsText: '',
      changeId: true,
      loginId: '',
      changePassword: true,
      password: '',
      // Masti changes them monthly.
      passwordSchedule: 'MONTHLY',
      userIds: [],
    }
  }
  return {
    departmentCode: portal.department.code,
    name: portal.name,
    loginUrl: portal.loginUrl ?? '',
    idLabel: portal.idLabel,
    hasExtra: portal.extraLabel !== null,
    extraLabel: portal.extraLabel ?? '',
    // A saved extra box keeps its value unless the HOD types a new one.
    changeExtra: false,
    extra: '',
    stepsText: portal.steps.join('\n'),
    changeId: false,
    loginId: '',
    // A locked portal is waiting for exactly this.
    changePassword: portal.locked,
    password: '',
    passwordSchedule: portal.passwordSchedule,
    userIds: portal.users.map((u) => u.id),
  }
}

/**
 * The ID, the password and the extra box's value go only when typed: left alone, the saved ones stay. An extra box
 * turned off (`hasExtra` false) on a portal that had one is removed with `extraLabel: ""`.
 */
function toBody(values: PortalFormValues, hadExtra: boolean): PortalBody {
  return {
    name: values.name.trim(),
    loginUrl: values.loginUrl.trim(),
    idLabel: values.idLabel.trim(),
    passwordSchedule: values.passwordSchedule,
    userIds: values.userIds,
    steps: stepsFromText(values.stepsText),
    ...(values.changeId ? { loginId: values.loginId.trim() } : {}),
    ...(values.changePassword ? { password: values.password } : {}),
    ...(values.hasExtra
      ? { extraLabel: values.extraLabel.trim(), ...(values.changeExtra ? { extra: values.extra } : {}) }
      : hadExtra
        ? { extraLabel: '' }
        : {}),
  }
}

/**
 * Add a portal to a department the person manages, or change one (docs/decisions/0024-portal-logins.md). A portal stays
 * in its department. When editing, the saved ID and password are never shown; "Change the ID" or "Change the password"
 * opens an empty box, so Chrome can't quietly fill in someone's own password. A save over someone else's change is
 * refused. "Password changes" sets the schedule (component 2); a locked portal opens with its password box, since a new
 * password is what unlocks it.
 */
export function PortalDrawer({
  portal,
  departments,
  onClose,
}: {
  portal: Portal | null
  /** The departments this person may add portals to. */
  departments: { code: string; name: string }[]
  onClose: () => void
}) {
  const toast = useToast()
  const isNew = portal === null
  // A saved extra box keeps its value behind a "Change the value" toggle, like the password.
  const hadExtra = portal?.extraLabel != null
  // The version this form was opened on: a background refetch must not hide a conflict.
  const [openedAt] = useState(portal?.updatedAt)

  const form = useForm<PortalFormValues>({
    resolver: zodResolver(portalFormSchema),
    defaultValues: formDefaults(portal, departments[0]?.code ?? ''),
  })
  const { register, handleSubmit, control, setError, setValue, formState } = form
  const { errors } = formState
  const departmentCode = useWatch({ control, name: 'departmentCode' })
  const changeId = useWatch({ control, name: 'changeId' })
  const changePassword = useWatch({ control, name: 'changePassword' })
  const hasExtra = useWatch({ control, name: 'hasExtra' })
  const changeExtra = useWatch({ control, name: 'changeExtra' })
  const people = usePortalPeople(departmentCode)
  const staff = (people.data ?? []).filter((p) => p.role === 'STAFF')

  const save = useSavePortal()
  const drawer = useDrawerGuard(formState.isDirty, onClose)

  const onSubmit = handleSubmit((values) => {
    const body = toBody(values, portal?.extraLabel != null)
    save.mutate(
      portal
        ? { id: portal.id, body: { ...body, updatedAt: openedAt ?? portal.updatedAt } }
        : { body: { ...body, departmentCode: values.departmentCode } },
      {
        onSuccess: (saved) => {
          toast({ tone: 'ok', message: isNew ? `${saved.name} added. Its ID and password are locked away.` : `${saved.name} saved.` })
          drawer.release()
          onClose()
        },
        onError: (error) => {
          if (isStale(error)) return onClose()
          applyServerIssues(error, setError, FIELDS)
        },
      },
    )
  })
  const message = errorText(save.error)

  return (
    <>
      <div className="overlay" {...drawer.overlayProps}>
        <form className="drawer" onSubmit={onSubmit} noValidate autoComplete="off">
          <div className="pad drawer-head">
            <h2 className="h2">{isNew ? 'Add a portal' : `Change ${portal.name}`}</h2>
            <p className="muted">
              {isNew ? 'Staff will press Log in for me and never see the ID or password.' : `A ${portal.department.name} portal.`}
            </p>
          </div>

          <div className="pad drawer-body">
            {portal?.locked && portal.passwordDueOn && (
              <div className="alert alert-bad" role="status">
                {lockedNote(portal.passwordDueOn)}
              </div>
            )}
            {isNew && departments.length > 1 && (
              <FormField label="Department" required error={errors.departmentCode?.message}>
                <select className="select" {...register('departmentCode', { onChange: () => setValue('userIds', []) })}>
                  {departments.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}

            <FormField label="Portal name" required error={errors.name?.message}>
              <input className="input" {...register('name')} placeholder="France visa portal" autoFocus={isNew} aria-required="true" />
            </FormField>

            <FormField
              label="Login page address"
              required
              error={errors.loginUrl?.message}
              hint="Open the portal's login page and copy the address from the top of the browser."
            >
              <input className="input" {...register('loginUrl')} placeholder="https://" inputMode="url" aria-required="true" />
            </FormField>

            <FormField label="What the portal calls the first box" required error={errors.idLabel?.message} hint="e.g. ID, User ID, Email, Agency code">
              <input className="input" {...register('idLabel')} aria-required="true" />
            </FormField>

            <label className="check portal-extra-toggle">
              <input type="checkbox" {...register('hasExtra')} />
              This portal has a third box before the ID (e.g. an agency code)
            </label>
            {hasExtra && (
              <>
                <FormField label="What the extra box is called" required error={errors.extraLabel?.message} hint="e.g. Agency code">
                  <input className="input" {...register('extraLabel')} placeholder="Agency code" aria-required="true" />
                </FormField>
                {changeExtra || !hadExtra ? (
                  <FormField
                    label="The extra box's value"
                    required
                    error={errors.extra?.message}
                    hint="Staff never see it. It's locked away as soon as you save."
                  >
                    <Controller
                      control={control}
                      name="extra"
                      render={({ field }) => (
                        <PasswordInput
                          name={field.name}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          autoComplete="new-password"
                          aria-required="true"
                        />
                      )}
                    />
                  </FormField>
                ) : (
                  <div className="portal-change">
                    <span className="muted small">The saved value stays.</span>
                    <button type="button" className="btn btn-sm" onClick={() => setValue('changeExtra', true, { shouldDirty: true })}>
                      Change the value
                    </button>
                  </div>
                )}
              </>
            )}

            {changeId ? (
              <FormField label="The ID" required error={errors.loginId?.message}>
                <input className="input" {...register('loginId')} autoComplete="off" spellCheck={false} aria-required="true" />
              </FormField>
            ) : (
              <div className="portal-change">
                <span className="muted small">The saved ID stays.</span>
                <button type="button" className="btn btn-sm" onClick={() => setValue('changeId', true, { shouldDirty: true })}>
                  Change the ID
                </button>
              </div>
            )}

            {changePassword ? (
              <>
                <FormField label="The password" required error={errors.password?.message} hint="Staff never see it. It's locked away as soon as you save.">
                  <Controller
                    control={control}
                    name="password"
                    render={({ field }) => (
                      <PasswordInput
                        name={field.name}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        autoComplete="new-password"
                        aria-required="true"
                      />
                    )}
                  />
                </FormField>
                {!isNew && (
                  <div className="portal-change">
                    <span className="muted small">{portal.locked ? 'Without a new one it stays locked.' : ''}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setValue('changePassword', false, { shouldDirty: true })
                        setValue('password', '')
                      }}
                    >
                      Keep the saved password
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="portal-change">
                <span className="muted small">The saved password stays.</span>
                <button type="button" className="btn btn-sm" onClick={() => setValue('changePassword', true, { shouldDirty: true })}>
                  Change the password
                </button>
              </div>
            )}

            <FormField
              label="Password changes"
              required
              error={errors.passwordSchedule?.message}
              hint="On the due date the portal locks for everyone until you type the new password here."
            >
              <select className="select" {...register('passwordSchedule')}>
                {SCHEDULE_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Steps to show on the portal (optional)"
              error={errors.stepsText?.message}
              hint="One per line. The helper shows them in the portal's tab after it logs in."
            >
              <textarea
                className="input"
                rows={4}
                {...register('stepsText')}
                placeholder={'Fill the application form\nEnter the acknowledgement number\nBook the appointment'}
              />
            </FormField>

            <span className="lbl section-lbl">Who may use it</span>
            <p className="muted small portal-people-hint">The Head and the department's HOD always can.</p>
            {people.isPending ? (
              <p className="muted small">Loading…</p>
            ) : staff.length === 0 ? (
              <p className="muted small">Nobody else works in this department yet.</p>
            ) : (
              <div className="portal-people">
                {staff.map((person) => (
                  <label key={person.id} className="check">
                    <input type="checkbox" value={person.id} {...register('userIds')} />
                    {person.name}
                  </label>
                ))}
              </div>
            )}
            {errors.userIds?.message && (
              <span className="field-error" role="alert">
                {errors.userIds.message}
              </span>
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
              {save.isPending ? 'Saving…' : isNew ? 'Add portal' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
      {drawer.dialog}
    </>
  )
}
