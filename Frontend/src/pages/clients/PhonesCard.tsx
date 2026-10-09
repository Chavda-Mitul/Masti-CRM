import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormField } from '../../components/FormField'
import { formatMobile } from '../../lib/format'
import { filtered, mobileChars } from '../../lib/inputFilters'
import { applyServerIssues, errorText, existingClientId } from './apiErrors'
import { useAddPhone, useChangeMainNumber, useRemovePhone } from './queries'
import {
  mainNumberFormSchema,
  normaliseMobile,
  phoneFormSchema,
  type MainNumberFormValues,
  type PhoneFormValues,
} from './schemas'
import type { ClientPhone, ClientProfile } from './types'
import { useDuplicateGuard } from './useDuplicateGuard'

/** A sanity limit, matching the backend. */
const MAX_EXTRA_PHONES = 5

/** The main number (lookup + WhatsApp) and up to five extra numbers, which client lookup also matches. */
export function PhonesCard({ client, canEdit }: { client: ClientProfile; canEdit: boolean }) {
  const [changingMain, setChangingMain] = useState<{ prefill: string } | null>(null)
  const [removing, setRemoving] = useState<ClientPhone | null>(null)
  const remove = useRemovePhone(client.id)

  return (
    <div className="card">
      <div className="pad card-head">
        <h2 className="h2">Numbers</h2>
      </div>
      <ul className="plain-list">
        <li>
          <div>
            <div className="mono">{formatMobile(client.mobile)}</div>
            <span className="chip chip-info chip-sm">Main · WhatsApp</span>
          </div>
          {canEdit && (
            <button className="btn btn-sm" onClick={() => setChangingMain({ prefill: '' })}>
              Change
            </button>
          )}
        </li>
        {client.phones.map((p) => (
          <li key={p.id}>
            <div>
              <div className="mono">{formatMobile(p.mobile)}</div>
              {p.label && <div className="muted small">{p.label}</div>}
            </div>
            {canEdit && (
              <div className="row-actions">
                <button className="btn btn-sm" onClick={() => setChangingMain({ prefill: formatMobile(p.mobile) })}>
                  Make main
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setRemoving(p)}>
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit && client.phones.length < MAX_EXTRA_PHONES && <AddPhoneForm clientId={client.id} />}

      {changingMain && <MainNumberDialog client={client} prefill={changingMain.prefill} onClose={() => setChangingMain(null)} />}

      {removing && (
        <ConfirmDialog
          title={`Remove ${formatMobile(removing.mobile)}?`}
          body="Client lookup will stop matching this number. The change is recorded."
          confirmLabel="Remove"
          danger
          pending={remove.isPending}
          error={errorText(remove.error)}
          onCancel={() => {
            setRemoving(null)
            remove.reset()
          }}
          onConfirm={() => remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
        />
      )}
    </div>
  )
}

function AddPhoneForm({ clientId }: { clientId: string }) {
  const add = useAddPhone(clientId)
  const guard = useDuplicateGuard()
  const { register, handleSubmit, reset, setError, formState } = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: { mobile: '', label: '' },
  })

  const send = (body: { mobile: string; label: string | null; confirmDuplicates?: boolean }) =>
    add.mutate(body, {
      onSuccess: () => reset(),
      onError: (error) => {
        if (guard.intercept(error, () => send({ ...body, confirmDuplicates: true }))) return
        applyServerIssues(error, setError, ['mobile', 'label'])
      },
    })

  const onSubmit = handleSubmit((values) => send({ mobile: normaliseMobile(values.mobile) ?? values.mobile, label: values.label.trim() || null }))
  const message = errorText(add.error)

  return (
    <>
      <form className="pad add-phone" onSubmit={onSubmit} noValidate>
        <span className="lbl">Add another number</span>
        <div className="add-phone-row">
          <FormField label="Mobile" error={formState.errors.mobile?.message}>
            <input className="input mono" {...filtered(register('mobile'), mobileChars)} placeholder="98250 41234" inputMode="tel" />
          </FormField>
          <FormField label="Whose / which" error={formState.errors.label?.message}>
            <input className="input" {...register('label')} placeholder="Whose number is this?" />
          </FormField>
          <button type="submit" className="btn" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {message && <div className="alert alert-bad">{message}</div>}
      </form>
      {guard.modal}
    </>
  )
}

function MainNumberDialog({ client, prefill, onClose }: { client: ClientProfile; prefill: string; onClose: () => void }) {
  const change = useChangeMainNumber(client.id)
  const guard = useDuplicateGuard()
  const { register, handleSubmit, formState } = useForm<MainNumberFormValues>({
    resolver: zodResolver(mainNumberFormSchema),
    defaultValues: { mobile: prefill, keepOldAsSecondary: true },
  })

  const send = (body: { mobile: string; keepOldAsSecondary: boolean; confirmDuplicates?: boolean }) =>
    change.mutate(body, {
      onSuccess: onClose,
      onError: (error) => {
        guard.intercept(error, () => send({ ...body, confirmDuplicates: true }))
      },
    })

  const onSubmit = handleSubmit((values) =>
    send({ mobile: normaliseMobile(values.mobile) ?? values.mobile, keepOldAsSecondary: values.keepOldAsSecondary }),
  )
  const existingId = existingClientId(change.error)
  const message = existingId ? null : errorText(change.error)

  return (
    <>
      <div className="overlay overlay-center" onClick={onClose}>
        <form className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} noValidate>
          <h2 className="h2">Change the main number</h2>
          <p style={{ margin: 0 }}>
            The main number is how the client is found at enquiry, and where WhatsApp updates go. It is now{' '}
            <span className="mono">{formatMobile(client.mobile)}</span>.
          </p>
          <FormField label="New main number" error={formState.errors.mobile?.message}>
            <input className="input mono" {...filtered(register('mobile'), mobileChars)} placeholder="98250 41234" inputMode="tel" autoFocus />
          </FormField>
          <label className="check">
            <input type="checkbox" {...register('keepOldAsSecondary')} />
            Keep {formatMobile(client.mobile)} as an extra number
          </label>
          {existingId && (
            <div className="alert alert-bad">
              This is already the main number of another client. <Link to={`/clients/${existingId}`}>Open that client</Link>
            </div>
          )}
          {message && <div className="alert alert-bad">{message}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={change.isPending}>
              {change.isPending ? 'Saving…' : 'Make it the main number'}
            </button>
          </div>
        </form>
      </div>
      {guard.modal}
    </>
  )
}
