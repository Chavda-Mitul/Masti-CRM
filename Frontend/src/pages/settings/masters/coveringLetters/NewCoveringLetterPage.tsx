import { zodResolver } from '@hookform/resolvers/zod'
import type { FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { canEditVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { applyServerIssues, errorBody, errorText } from '../../../../lib/apiErrors'
import { istToday } from '../../../../lib/format'
import { useToast } from '../../../../lib/toast'
import { useCreateCoveringLetter } from '../queries'
import {
  coveringLetterFormSchema,
  normaliseWording,
  wordingFormSchema,
  type CoveringLetterFormValues,
  type WordingFormValues,
} from '../schemas'
import { DETAILS_FIELDS, detailsBody, detailsDefaults, WORDING_FIELDS } from './forms'
import { STARTING_WORDING } from './labels'
import { LetterDetailsFields } from './LetterDetailsFields'
import { useLeaveGuard } from './useLeaveGuard'
import { WordingFields } from './WordingFields'

/** Add a covering letter: which cases it fits, and its first wording. The Visa HOD or the Head only. */
export function NewCoveringLetterPage() {
  const { data: me } = useMe()
  if (!me) return null
  if (!canEditVisaMasters(me)) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <Link to="/settings/masters/covering-letters" className="back-link">
          ‹ Covering letters
        </Link>
        <p className="muted">Only the Head or the Visa HOD adds covering letters.</p>
      </div>
    )
  }
  return <NewLetterForm />
}

function NewLetterForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateCoveringLetter()
  const details = useForm<CoveringLetterFormValues>({ resolver: zodResolver(coveringLetterFormSchema), defaultValues: detailsDefaults(null) })
  const wording = useForm<WordingFormValues>({
    resolver: zodResolver(wordingFormSchema),
    defaultValues: { body: STARTING_WORDING, effectiveFrom: istToday() },
  })
  const guard = useLeaveGuard(details.formState.isDirty || wording.formState.isDirty, 'This covering letter hasn’t been added yet.')

  // Both parts are checked, so every mistake shows at once; it's sent only when both are fine.
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const checked: { wording?: WordingFormValues } = {}
    await wording.handleSubmit((values) => {
      checked.wording = values
    })()
    await details.handleSubmit((values) => {
      if (!checked.wording) return
      create.mutate(
        { ...detailsBody(values), body: normaliseWording(checked.wording.body), effectiveFrom: checked.wording.effectiveFrom },
        {
          onSuccess: (letter) => {
            guard.release()
            toast({ tone: 'ok', message: `${letter.name} added.` })
            navigate(`/settings/masters/covering-letters/${letter.id}`, { replace: true })
          },
          onError: (err) => {
            applyServerIssues(err, details.setError, DETAILS_FIELDS)
            applyServerIssues(err, wording.setError, WORDING_FIELDS)
          },
        },
      )
    })()
  }

  // A 400 that names the fields shows beside them; anything else shows here.
  const message = errorBody(create.error)?.issues ? null : errorText(create.error)

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="letter-page">
      <div className="page-head">
        <div>
          <Link to="/settings/masters/covering-letters" className="back-link">
            ‹ Covering letters
          </Link>
          <h1 className="h1">Add a covering letter</h1>
          <p>Which cases it fits, and its wording. Each case fills in its own travellers, passports and dates.</p>
        </div>
      </div>

      <section className="card pad letter-card">
        <h2 className="h2">Which cases it fits</h2>
        <div className="form-grid">
          <LetterDetailsFields form={details} letter={null} />
        </div>
      </section>

      <section className="card pad letter-card">
        <h2 className="h2">The wording</h2>
        <WordingFields form={wording} />
      </section>

      {message && (
        <div className="alert alert-bad" role="alert">
          {message}
        </div>
      )}

      <div className="wording-actions">
        <Link to="/settings/masters/covering-letters" className="btn">
          Cancel
        </Link>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add the letter'}
        </button>
      </div>
      {guard.dialog}
    </form>
  )
}
