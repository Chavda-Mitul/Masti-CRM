import { useState, type ChangeEvent, type FormEvent } from 'react'
import { FormField } from '../../../components/FormField'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useSaveConsentDetails } from '../queries'
import type { CaseTraveller, ConsentDetails } from '../types'
import { travellerTab } from './labels'

type Field =
  | 'dateOfBirth'
  | 'spouseDateOfBirth'
  | 'anniversary'
  | 'motherDateOfBirth'
  | 'fatherDateOfBirth'
  | 'residentialAddress'
  | 'officeAddress'
  | 'annualIncome'
  | 'profession'
  | 'education'
type Form = Record<Field, string>

const toForm = (d: ConsentDetails): Form => ({
  dateOfBirth: d.dateOfBirth ?? '',
  spouseDateOfBirth: d.spouseDateOfBirth ?? '',
  anniversary: d.anniversary ?? '',
  motherDateOfBirth: d.motherDateOfBirth ?? '',
  fatherDateOfBirth: d.fatherDateOfBirth ?? '',
  residentialAddress: d.residentialAddress ?? '',
  officeAddress: d.officeAddress ?? '',
  annualIncome: d.annualIncome === null ? '' : String(d.annualIncome),
  profession: d.profession ?? '',
  education: d.education ?? '',
})

/**
 * The consent form's details for one traveller (docs/decisions/0022-consent-form.md, part 1). Staff fill them in by
 * asking the client; they're saved on the person, for life, so the next case already has them. The date of birth and
 * the home address are needed ⚠️; the rest stays empty when it doesn't apply (a child has no spouse or income).
 */
export function ConsentDetailsDialog({
  caseNo,
  traveller,
  details,
  onClose,
}: {
  caseNo: string
  traveller: CaseTraveller
  details: ConsentDetails
  onClose: () => void
}) {
  const toast = useToast()
  const save = useSaveConsentDetails(caseNo)
  const [form, setForm] = useState<Form>(() => toForm(details))
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const issues = errorBody(save.error)?.issues
  const errorOf = (field: Field) => errors[field] ?? issues?.[field]?.[0]
  const message = issues ? null : errorText(save.error)
  const today = istToday()
  const name = traveller.member?.name ?? travellerTab(traveller).name

  const set = (field: Field) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value })
  const date = (field: Field, label: string, required = false) => (
    <FormField label={label} required={required} error={errorOf(field)}>
      <input className="input" type="date" max={today} value={form[field]} onChange={set(field)} />
    </FormField>
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const income = form.annualIncome.replace(/[,\s]/g, '')
    const missing: Partial<Record<Field, string>> = {}
    if (!form.dateOfBirth) missing.dateOfBirth = 'Enter the date of birth.'
    if (!form.residentialAddress.trim()) missing.residentialAddress = 'Enter the home address.'
    if (income && !/^\d+$/.test(income)) missing.annualIncome = 'Whole rupees, digits only.'
    setErrors(missing)
    if (Object.keys(missing).length) return
    const orNull = (value: string) => value.trim() || null
    save.mutate(
      {
        travellerId: traveller.id,
        dateOfBirth: form.dateOfBirth,
        spouseDateOfBirth: orNull(form.spouseDateOfBirth),
        anniversary: orNull(form.anniversary),
        motherDateOfBirth: orNull(form.motherDateOfBirth),
        fatherDateOfBirth: orNull(form.fatherDateOfBirth),
        residentialAddress: form.residentialAddress.trim(),
        officeAddress: orNull(form.officeAddress),
        annualIncome: income ? Number(income) : null,
        profession: orNull(form.profession),
        education: orNull(form.education),
        updatedAt: details.personUpdatedAt,
      },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `Details saved for ${name}.` })
          onClose()
        },
      },
    )
  }

  return (
    <div className="overlay overlay-center" onClick={onClose}>
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

        <div className="lbl section-lbl">Person</div>
        <div className="form-grid">{date('dateOfBirth', 'Date of birth', true)}</div>

        <div className="lbl section-lbl">Family</div>
        <div className="form-grid">
          {date('spouseDateOfBirth', 'Spouse’s date of birth')}
          {date('anniversary', 'Anniversary')}
          {date('motherDateOfBirth', 'Mother’s date of birth')}
          {date('fatherDateOfBirth', 'Father’s date of birth')}
        </div>

        <div className="lbl section-lbl">Addresses</div>
        <div className="form-grid">
          <FormField label="Home address" required wide error={errorOf('residentialAddress')}>
            <textarea className="textarea" rows={2} maxLength={300} value={form.residentialAddress} onChange={set('residentialAddress')} />
          </FormField>
          <FormField label="Office address" wide error={errorOf('officeAddress')}>
            <textarea className="textarea" rows={2} maxLength={300} value={form.officeAddress} onChange={set('officeAddress')} />
          </FormField>
        </div>

        <div className="lbl section-lbl">Work</div>
        <div className="form-grid">
          <FormField label="Profession" error={errorOf('profession')}>
            <input className="input" maxLength={100} value={form.profession} onChange={set('profession')} />
          </FormField>
          <FormField label="Annual income (₹)" error={errorOf('annualIncome')}>
            <input className="input" inputMode="numeric" value={form.annualIncome} onChange={set('annualIncome')} />
          </FormField>
          <FormField label="Education" wide error={errorOf('education')}>
            <input className="input" maxLength={100} value={form.education} onChange={set('education')} />
          </FormField>
        </div>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </form>
    </div>
  )
}
