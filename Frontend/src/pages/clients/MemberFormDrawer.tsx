import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { FormField } from '../../components/FormField'
import { istToday } from '../../lib/format'
import { applyServerIssues, errorText, isStale } from './apiErrors'
import { changedIn, filledIn, memberBody, memberFormDefaults } from './forms'
import { useSaveMember } from './queries'
import { memberFormSchema, type MemberFormValues } from './schemas'
import type { ClientMember, ClientOptions, MemberBody } from './types'
import { useDuplicateGuard } from './useDuplicateGuard'

/** Add a person to the family list, or edit one. A passport number already on file elsewhere asks for confirmation. */
export function MemberFormDrawer({
  clientId,
  member,
  options,
  onClose,
}: {
  clientId: string
  member: ClientMember | null
  options: ClientOptions
  onClose: () => void
}) {
  const isNew = member === null
  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: memberFormDefaults(member),
  })
  const { register, handleSubmit, setError, formState } = form
  const { errors } = formState

  const save = useSaveMember(clientId)
  const guard = useDuplicateGuard()

  const send = (body: MemberBody) => {
    save.mutate(
      { ...(member ? { memberId: member.id } : {}), body: member ? { ...body, updatedAt: member.updatedAt } : body },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (guard.intercept(error, () => send({ ...body, confirmDuplicates: true }))) return
          if (isStale(error)) return onClose()
          applyServerIssues(error, setError, Object.keys(form.getValues()))
        },
      },
    )
  }

  const onSubmit = handleSubmit((values) => {
    const body = memberBody(values, isNew ? filledIn(values) : changedIn<MemberFormValues>(formState.dirtyFields))
    if (!isNew && Object.keys(body).length === 0) return onClose()
    send(body)
  })

  const message = errorText(save.error)

  return (
    <>
      <div className="overlay" onClick={onClose}>
        <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} noValidate>
          <div className="pad drawer-head">
            <h2 className="h2">{isNew ? 'Add a person' : `Edit ${member.name}`}</h2>
            <p className="muted">Family members who travel, or a company&apos;s employees. Use the name exactly as in the passport.</p>
          </div>

          <div className="pad drawer-body">
            <div className="form-grid">
              <FormField label="Name as in passport" error={errors.name?.message} wide>
                <input className="input" {...register('name')} placeholder="Priya Rajesh Patel" autoFocus />
              </FormField>
              <FormField label="Relation" error={errors.relationId?.message}>
                <select className="select" {...register('relationId')}>
                  <option value="">Pick…</option>
                  {options.relations.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Date of birth" error={errors.dateOfBirth?.message}>
                <input className="input" type="date" max={istToday()} {...register('dateOfBirth')} />
              </FormField>
              <FormField label="Own mobile" error={errors.mobile?.message} hint="Optional.">
                <input className="input mono" {...register('mobile')} placeholder="98250 41234" inputMode="tel" />
              </FormField>
            </div>

            <span className="lbl section-lbl">Current passport</span>
            <div className="form-grid">
              <FormField label="Passport number" error={errors.passportNumber?.message}>
                <input className="input mono upper" {...register('passportNumber')} placeholder="Z1234567" maxLength={14} />
              </FormField>
              <FormField label="Valid till" error={errors.passportExpiry?.message}>
                <input className="input" type="date" {...register('passportExpiry')} />
              </FormField>
            </div>
            {!isNew && <span className="hint">A renewed passport replaces the old number here; the old one stays in the history.</span>}

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
              {save.isPending ? 'Saving…' : isNew ? 'Add person' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
      {guard.modal}
    </>
  )
}
