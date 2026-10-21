import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FormField } from '../../../components/FormField'
import { PasswordInput } from '../../../components/PasswordInput'
import { useDrawerGuard } from '../../../components/useDrawerGuard'
import { applyServerIssues, errorText, isStale } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { usePortalPeople, useSavePortal } from './queries'
import { portalFormSchema, type PortalFormValues } from './schemas'
import type { Portal, PortalBody } from './types'

const FIELDS = ['departmentCode', 'name', 'loginUrl', 'idLabel', 'loginId', 'password', 'userIds'] as const

function formDefaults(portal: Portal | null, departmentCode: string): PortalFormValues {
  if (!portal) {
    return { departmentCode, name: '', loginUrl: '', idLabel: 'ID', changeId: true, loginId: '', changePassword: true, password: '', userIds: [] }
  }
  return {
    departmentCode: portal.department.code,
    name: portal.name,
    loginUrl: portal.loginUrl ?? '',
    idLabel: portal.idLabel,
    changeId: false,
    loginId: '',
    changePassword: false,
    password: '',
    userIds: portal.users.map((u) => u.id),
  }
}

/** The ID and the password go only when typed: left alone, the saved ones stay. */
function toBody(values: PortalFormValues): PortalBody {
  return {
    name: values.name.trim(),
    loginUrl: values.loginUrl.trim(),
    idLabel: values.idLabel.trim(),
    userIds: values.userIds,
    ...(values.changeId ? { loginId: values.loginId.trim() } : {}),
    ...(values.changePassword ? { password: values.password } : {}),
  }
}

/**
 * Add a portal to a department the person manages, or change one (docs/decisions/0024-portal-logins.md). A portal stays
 * in its department. When editing, the saved ID and password are never shown; "Change the ID" or "Change the password"
 * opens an empty box, so Chrome can't quietly fill in someone's own password. A save over someone else's change is
 * refused.
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
  const people = usePortalPeople(departmentCode)
  const staff = (people.data ?? []).filter((p) => p.role === 'STAFF')

  const save = useSavePortal()
  const drawer = useDrawerGuard(formState.isDirty, onClose)

  const onSubmit = handleSubmit((values) => {
    const body = toBody(values)
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
            ) : (
              <div className="portal-change">
                <span className="muted small">The saved password stays.</span>
                <button type="button" className="btn btn-sm" onClick={() => setValue('changePassword', true, { shouldDirty: true })}>
                  Change the password
                </button>
              </div>
            )}

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
