import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { ConsentWording } from '../../../../components/ConsentWording'
import { RequiredMark } from '../../../../components/FormField'
import { useLeaveGuard } from '../../../../components/useLeaveGuard'
import { applyServerIssues, errorBody, errorText, isStale } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useAddConsentWording } from '../queries'
import { consentWordingFormSchema, MAX_CONSENT_WORDING_CHARS, normaliseWording, type ConsentWordingFormValues } from '../schemas'
import type { ConsentWordingVersion } from '../types'

/**
 * "Change the wording" of the consent form (docs/decisions/0022-consent-form.md, part 2b): saved as a new version, used
 * from that moment, after a confirmation. The one in use stays on record with every consent given to it. Starts from the
 * wording in use. If someone else changed it meanwhile, the draft stays: Reload brings their version in, then it can be
 * saved.
 */
export function ConsentWordingEditor({
  inUse,
  onClose,
  onReload,
}: {
  inUse: ConsentWordingVersion
  onClose: () => void
  onReload: () => Promise<ConsentWordingVersion | undefined>
}) {
  const toast = useToast()
  const add = useAddConsentWording()
  const [basedOnId, setBasedOnId] = useState(inUse.id)
  const [stale, setStale] = useState(false)
  // The words waiting for "Use this wording", once the form is valid.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)

  const form = useForm<ConsentWordingFormValues>({ resolver: zodResolver(consentWordingFormSchema), defaultValues: { body: inUse.body } })
  const dirty = form.formState.isDirty
  const guard = useLeaveGuard(dirty, 'The wording you wrote here hasn’t been saved.')
  const body = useWatch({ control: form.control, name: 'body' })
  const error = form.formState.errors.body

  const onSave = form.handleSubmit((values) => setConfirming(normaliseWording(values.body)))

  const save = (text: string) =>
    add.mutate(
      { body: text, basedOnId },
      {
        onSuccess: () => {
          guard.release()
          toast({ tone: 'ok', message: 'Saved. Clients agree to this wording from now on.' })
          onClose()
        },
        onError: (err) => {
          setConfirming(null)
          if (isStale(err)) setStale(true)
          else applyServerIssues(err, form.setError, ['body'])
        },
      },
    )

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) setBasedOnId(fresh.id)
    setStale(false)
    add.reset()
  }

  // A 400 that names the field shows beside it; anything else shows here.
  const message = errorBody(add.error)?.issues ? null : errorText(add.error)
  const length = normaliseWording(body).length

  return (
    <form onSubmit={onSave} noValidate className="wording-editor">
      <div>
        <h2 className="h2">Change the wording</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Saving makes it the wording clients agree to from then on. The one in use stays on record, with everyone who agreed
          to it.
        </p>
      </div>

      {stale && (
        <div className="alert alert-warn stale-bar" role="alert">
          Someone else changed the wording after you opened it, so yours wasn’t saved. Reload to bring in their change; your
          wording stays here to check and save again.
          <button type="button" className="btn btn-sm" onClick={() => void reload()}>
            Reload
          </button>
        </div>
      )}

      <label className={`field${error ? ' field-invalid' : ''}`}>
        <span>
          The wording
          <RequiredMark />
        </span>
        <textarea {...form.register('body')} className="input textarea wording-text" rows={18} aria-required />
        {error ? (
          <span className="field-error" role="alert">
            {error.message}
          </span>
        ) : (
          <span className="hint">
            A blank line starts a new paragraph. {length.toLocaleString('en-IN')} of{' '}
            {MAX_CONSENT_WORDING_CHARS.toLocaleString('en-IN')} characters.
          </span>
        )}
      </label>

      <div className="wording-preview">
        <div className="lbl">As the client sees it</div>
        <ConsentWording body={body} />
      </div>

      {message && (
        <div className="alert alert-bad" role="alert">
          {message}
        </div>
      )}

      <div className="wording-actions">
        <button type="button" className="btn" onClick={() => (dirty ? setDiscarding(true) : onClose())} disabled={add.isPending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={add.isPending || stale}>
          {add.isPending ? 'Saving…' : 'Save the wording'}
        </button>
      </div>

      {confirming !== null && (
        <ConfirmDialog
          title="Use this wording from now on?"
          body="Clients who tap I agree from now on agree to it. Those who already agreed keep the wording they agreed to."
          confirmLabel="Use this wording"
          pending={add.isPending}
          error={null}
          onCancel={() => setConfirming(null)}
          onConfirm={() => save(confirming)}
        />
      )}
      {discarding && (
        <ConfirmDialog
          title="Discard this wording?"
          body="What you wrote here hasn’t been saved."
          confirmLabel="Discard"
          danger
          pending={false}
          error={null}
          onCancel={() => setDiscarding(false)}
          onConfirm={onClose}
        />
      )}
      {guard.dialog}
    </form>
  )
}
