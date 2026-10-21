import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { useLeaveGuard } from '../../../../components/useLeaveGuard'
import { applyServerIssues, errorBody, errorText, isStale } from '../../../../lib/apiErrors'
import { formatDate, istToday } from '../../../../lib/format'
import { useToast } from '../../../../lib/toast'
import { useAddWording } from '../queries'
import { normaliseWording, wordingFormSchema, type WordingFormValues } from '../schemas'
import type { CoveringLetter, CoveringLetterWording } from '../types'
import { WORDING_FIELDS } from './forms'
import { WordingFields } from './WordingFields'

/**
 * "Change the wording" (docs/decisions/0019-covering-letters.md Decision 5): the change is kept as a new wording, used
 * from the day picked; the one in use stays on record. `replacing` is a wording whose day hasn't come yet: saving replaces
 * it. Starts from the wording in use, or from the one being replaced.
 * If someone else changed the letter meanwhile, the draft stays: Reload brings their change in, then it can be saved.
 */
export function WordingEditor({
  letter,
  replacing,
  onClose,
  onReload,
}: {
  letter: CoveringLetter
  replacing: CoveringLetterWording | null
  onClose: () => void
  onReload: () => Promise<CoveringLetter | undefined>
}) {
  const toast = useToast()
  const add = useAddWording(letter.id)
  const [openedAt, setOpenedAt] = useState(letter.updatedAt)
  const [stale, setStale] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const from = replacing ?? letter.versions.find((v) => v.status === 'IN_USE') ?? letter.versions[0]

  const form = useForm<WordingFormValues>({
    resolver: zodResolver(wordingFormSchema),
    defaultValues: { body: from?.body ?? '', effectiveFrom: replacing?.effectiveFrom ?? istToday() },
  })
  const dirty = form.formState.isDirty
  const guard = useLeaveGuard(dirty, 'The wording you wrote here hasn’t been saved.')

  const onSave = form.handleSubmit((values) =>
    add.mutate(
      {
        body: normaliseWording(values.body),
        effectiveFrom: values.effectiveFrom,
        ...(replacing ? { replacesId: replacing.id } : {}),
        updatedAt: openedAt,
      },
      {
        onSuccess: () => {
          guard.release()
          toast({
            tone: 'ok',
            message:
              values.effectiveFrom <= istToday()
                ? 'Saved. New letters use this wording from today.'
                : `Saved. New letters use this wording from ${formatDate(values.effectiveFrom)}.`,
          })
          onClose()
        },
        onError: (err) => {
          if (isStale(err)) setStale(true)
          else applyServerIssues(err, form.setError, WORDING_FIELDS)
        },
      },
    ),
  )

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) setOpenedAt(fresh.updatedAt)
    setStale(false)
    add.reset()
  }

  // A 400 that names the fields shows beside them; anything else shows here.
  const message = errorBody(add.error)?.issues ? null : errorText(add.error)

  return (
    <form onSubmit={onSave} noValidate className="wording-editor">
      <div>
        <h2 className="h2">{replacing ? `Change the wording that starts on ${formatDate(replacing.effectiveFrom)}` : 'Change the wording'}</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {replacing
            ? 'It hasn’t been used yet, so saving replaces it.'
            : 'Your change is kept as a new wording from the day you pick. The one in use stays on record.'}
        </p>
      </div>

      {stale && (
        <div className="alert alert-warn stale-bar" role="alert">
          Someone else changed this letter after you opened it, so your wording wasn’t saved. Reload to bring in their change;
          your wording stays here to check and save again.
          <button type="button" className="btn btn-sm" onClick={() => void reload()}>
            Reload
          </button>
        </div>
      )}

      <WordingFields form={form} />

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
