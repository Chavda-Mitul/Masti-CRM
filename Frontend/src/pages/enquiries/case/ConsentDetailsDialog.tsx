import { useState, type FormEvent } from 'react'
import { FormField } from '../../../components/FormField'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { CONSENT_ANSWER_MAX } from '../../settings/masters/schemas'
import { useConsentForm, useSaveConsentDetails } from '../queries'
import type { CaseTraveller, ConsentForm, ConsentFormField } from '../types'
import { travellerTab } from './labels'

/** A save the form recovers from by loading again: the fields changed in Settings, or the person changed meanwhile. */
const reloadable = (error: unknown) => ['FIELDS_CHANGED', 'STALE'].includes(errorCode(error) ?? '')

/**
 * The consent form's details for one traveller (docs/decisions/0022-consent-form.md, part 1). Staff fill them in by
 * asking the client; they're saved on the person, for life, so the next case already has them. The fields are a master
 * in Settings (amendment 1): what each takes, and which are required, come from there.
 */
export function ConsentDetailsDialog({ caseNo, traveller, onClose }: { caseNo: string; traveller: CaseTraveller; onClose: () => void }) {
  const form = useConsentForm(caseNo, traveller.id)
  const name = traveller.member?.name ?? travellerTab(traveller).name

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      {form.data ? (
        <Filling caseNo={caseNo} traveller={traveller} name={name} form={form.data} reload={() => void form.refetch()} onClose={onClose} />
      ) : (
        <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="consent-details-title" onClick={(e) => e.stopPropagation()}>
          <h2 className="h2" id="consent-details-title">
            Consent details · {name}
          </h2>
          {form.isError ? <div className="alert alert-bad">{errorText(form.error)}</div> : <p className="muted">Loading the form…</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Filling({
  caseNo,
  traveller,
  name,
  form,
  reload,
  onClose,
}: {
  caseNo: string
  traveller: CaseTraveller
  name: string
  form: ConsentForm
  reload: () => void
  onClose: () => void
}) {
  const toast = useToast()
  const save = useSaveConsentDetails(caseNo)
  // What staff typed, by field id. A field not touched shows the person's saved answer, as the form last loaded it.
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<Record<string, string>>({})
  const issues = errorBody(save.error)?.issues
  const today = istToday()

  const valueOf = (field: ConsentFormField) => typed[field.id] ?? form.answers[field.id] ?? ''
  const errorOf = (field: ConsentFormField) => missing[field.id] ?? issues?.[String(field.id)]?.[0]

  const input = (field: ConsentFormField) => {
    const common = {
      value: valueOf(field),
      onChange: (e: { target: { value: string } }) => setTyped({ ...typed, [field.id]: e.target.value }),
      'aria-required': field.required,
    }
    switch (field.kind) {
      case 'DATE':
        return <input className="input" type="date" max={today} {...common} />
      case 'NUMBER':
        return <input className="input" inputMode="numeric" {...common} />
      case 'LINK':
        return <input className="input" inputMode="url" maxLength={CONSENT_ANSWER_MAX.LINK} placeholder="Web address"{...common} />
      case 'LONG_TEXT':
        return <textarea className="textarea" rows={2} maxLength={CONSENT_ANSWER_MAX.LONG_TEXT} {...common} />
      default:
        return <input className="input" maxLength={CONSENT_ANSWER_MAX.TEXT} {...common} />
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const empty = Object.fromEntries(form.fields.filter((f) => f.required && !valueOf(f).trim()).map((f) => [f.id, 'Fill this in.']))
    setMissing(empty)
    if (Object.keys(empty).length) return
    const answers = Object.fromEntries(form.fields.map((f) => [f.id, valueOf(f).trim() || null]))
    save.mutate(
      { travellerId: traveller.id, answers, updatedAt: form.personUpdatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `Details saved for ${name}.` })
          onClose()
        },
        // The fields changed in Settings, or someone changed the person: load the form again, keeping what was typed.
        onError: (error) => {
          if (reloadable(error)) reload()
        },
      },
    )
  }

  const message = issues ? null : errorText(save.error)
  return (
    <form
      className="dialog dialog-wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-details-title"
      onClick={(e) => e.stopPropagation()}
      onSubmit={submit}
      noValidate
    >
      <h2 className="h2" id="consent-details-title">
        Consent details · {name}
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Ask the client and fill in what applies; leave the rest empty. They’re kept on {name}’s record, so the next case
        already has them.
      </p>

      <div className="form-grid">
        {form.fields.map((field) => (
          <FormField key={field.id} label={field.label} required={field.required} wide={field.kind === 'LONG_TEXT'} error={errorOf(field)}>
            {input(field)}
          </FormField>
        ))}
      </div>

      {message && <div className={`alert ${reloadable(save.error) ? 'alert-warn' : 'alert-bad'}`}>{message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  )
}
