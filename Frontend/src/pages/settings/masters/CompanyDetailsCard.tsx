import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMe } from '../../../auth/useAuth'
import { FormField } from '../../../components/FormField'
import { applyServerIssues, errorBody, errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { compact } from '../../clients/schemas'
import { useClientOptions } from '../../clients/queries'
import { useCompanyDetails, useCompanyImageLink, useInvoiceTerms, useSaveInvoiceTerms, useUpdateCompanyDetails, useUploadCompanyImage } from './queries'
import { companyDetailsFormSchema, type CompanyDetailsFormValues } from './schemas'
import type { CompanyDetails, CompanyImage, CompanyImageKind, CompanyView } from './types'

/** The backend's sanity limit for a logo or signature (company.service.ts MAX_IMAGE_BYTES). */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/**
 * Masti's own details (Setting rows "company.details" and "invoice.terms", docs/decisions/0008-visa-docket-dispatch.md
 * Decision 5, docs/decisions/0009-visa-invoice.md Decision 8): the "From" on the parcel sticker, and the invoice's
 * header, tax and bank details, terms, logo and signature. Everyone sees them; only the Head changes them. The tax and
 * bank details start empty: the Head types them in (decided 13 Oct 2026).
 */
export function CompanyDetailsCard() {
  const { data: me } = useMe()
  const view = useCompanyDetails()
  const isHead = me?.type === 'HEAD'

  return (
    <section className="card pad master-card company-card">
      <h2 className="h2">Company details &amp; invoice</h2>
      {view.isPending ? (
        <p className="muted">Loading…</p>
      ) : view.isError ? (
        <div className="alert alert-bad">{errorText(view.error)}</div>
      ) : (
        <>
          {view.data.missingForInvoice.length > 0 && (
            <div className="alert alert-warn">
              Needed before the first invoice: <strong>{view.data.missingForInvoice.join(', ')}</strong>.
              {!isHead && ' The Head fills these in.'}
            </div>
          )}
          {isHead ? <DetailsForm details={view.data.details} /> : <DetailsView details={view.data.details} />}
          <div className="company-extras">
            <TermsSection canEdit={isHead} />
            <div className="company-images">
              <ImageTile kind="logo" label="Logo" image={view.data.images.logo} canEdit={isHead} />
              <ImageTile kind="signature" label="Signature" image={view.data.images.signature} canEdit={isHead} note="Printed on every invoice." />
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/** For everyone but the Head. */
function DetailsView({ details: d }: { details: CompanyDetails }) {
  const options = useClientOptions()
  const state = options.data?.states.find((s) => s.code === d.stateCode)?.name ?? d.stateCode
  const rows: [string, string | null][] = [
    ['Name', d.name],
    ['Address', d.address],
    ['Phone', d.phone],
    ['24/7 phone', d.phone2],
    ['Email', d.email],
    ['Website', d.website],
    ['PAN', d.pan],
    ['GSTIN', d.gstin],
    ['State', state],
    ['Bank', d.bank && `${d.bank.accountName} · ${d.bank.bankName}, ${d.bank.branch}`],
    ['Account no.', d.bank?.accountNo ?? null],
    ['IFSC', d.bank?.ifsc ?? null],
    ['SWIFT', d.bank?.swift ?? null],
  ]
  return (
    <dl className="kv-list company-view">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? <span className="muted">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

const toForm = (d: CompanyDetails): CompanyDetailsFormValues => ({
  name: d.name,
  address: d.address,
  phone: d.phone,
  phone2: d.phone2 ?? '',
  email: d.email ?? '',
  website: d.website ?? '',
  pan: d.pan ?? '',
  gstin: d.gstin ?? '',
  stateCode: d.stateCode ?? '',
  accountName: d.bank?.accountName ?? '',
  accountNo: d.bank?.accountNo ?? '',
  bankName: d.bank?.bankName ?? '',
  branch: d.bank?.branch ?? '',
  ifsc: d.bank?.ifsc ?? '',
  swift: d.bank?.swift ?? '',
})

/** The form's values as the API takes them: blank is null, the bank is one object (or null when all of it is blank). */
function toBody(v: CompanyDetailsFormValues): Partial<CompanyDetails> {
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
  const bankBlank = [v.accountName, v.accountNo, v.bankName, v.branch, v.ifsc, v.swift].every((s) => s.trim() === '')
  return {
    name: v.name.trim(),
    address: v.address.trim(),
    phone: v.phone.trim(),
    phone2: orNull(v.phone2),
    email: orNull(v.email),
    website: orNull(v.website),
    pan: orNull(compact(v.pan)),
    gstin: orNull(compact(v.gstin)),
    stateCode: orNull(v.stateCode),
    bank: bankBlank
      ? null
      : {
          accountName: v.accountName.trim(),
          accountNo: v.accountNo.replace(/\s+/g, ''),
          bankName: v.bankName.trim(),
          branch: v.branch.trim(),
          ifsc: compact(v.ifsc),
          swift: orNull(compact(v.swift)),
        },
  }
}

const FIELDS = ['name', 'address', 'phone', 'phone2', 'email', 'website', 'pan', 'gstin', 'stateCode'] as const

function DetailsForm({ details }: { details: CompanyDetails }) {
  const toast = useToast()
  const update = useUpdateCompanyDetails()
  const options = useClientOptions()
  const { register, handleSubmit, formState, reset, setError } = useForm<CompanyDetailsFormValues>({
    resolver: zodResolver(companyDetailsFormSchema),
    defaultValues: toForm(details),
  })
  const { errors } = formState
  const bankError = errorBody(update.error)?.issues?.bank?.[0]

  const onSubmit = handleSubmit((values) => {
    // Only what changed: the server checks the GSTIN against the PAN and state as saved.
    const before = toBody(toForm(details))
    const after = toBody(values)
    const changed = Object.fromEntries(
      Object.entries(after).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof CompanyDetails])),
    )
    if (Object.keys(changed).length === 0) return
    update.mutate(changed, {
      onSuccess: (saved: CompanyView) => {
        reset(toForm(saved.details))
        toast({ tone: 'ok', message: 'Company details saved.' })
      },
      onError: (err) => applyServerIssues(err, setError, [...FIELDS]),
    })
  })

  return (
    <form onSubmit={onSubmit} noValidate className="settings-form company-form">
      <fieldset className="company-section">
        <legend className="lbl">Company</legend>
        <p className="muted small">The name, address and phone are printed as “From” on every parcel sticker, and head every invoice.</p>
        <div className="form-grid company-grid">
          <FormField label="Name" error={errors.name?.message}>
            <input className="input" {...register('name')} />
          </FormField>
          <FormField label="Phone" error={errors.phone?.message}>
            <input className="input" {...register('phone')} />
          </FormField>
          <FormField label="Address" error={errors.address?.message}>
            <textarea className="input textarea" rows={2} {...register('address')} />
          </FormField>
          <FormField label="24/7 phone" error={errors.phone2?.message}>
            <input className="input" {...register('phone2')} />
          </FormField>
          <FormField label="Email" error={errors.email?.message}>
            <input className="input" type="email" {...register('email')} placeholder="accounts@…" />
          </FormField>
          <FormField label="Website" error={errors.website?.message}>
            <input className="input" {...register('website')} placeholder="www.…" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="company-section">
        <legend className="lbl">Tax</legend>
        <div className="form-grid company-grid">
          <FormField label="GSTIN" error={errors.gstin?.message} hint="The PAN and state fill in from it when left empty.">
            <input className="input mono upper" {...register('gstin')} />
          </FormField>
          <FormField label="PAN" error={errors.pan?.message}>
            <input className="input mono upper" {...register('pan')} />
          </FormField>
          <FormField label="State" error={errors.stateCode?.message} hint="Decides CGST + SGST or IGST on each invoice.">
            <select className="select" {...register('stateCode')} disabled={options.isPending}>
              <option value="">Not set</option>
              {(options.data?.states ?? []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </fieldset>

      <fieldset className="company-section">
        <legend className="lbl">Bank</legend>
        <div className="form-grid company-grid">
          <FormField label="Account name" error={errors.accountName?.message}>
            <input className="input" {...register('accountName')} />
          </FormField>
          <FormField label="Account number" error={errors.accountNo?.message}>
            <input className="input mono" inputMode="numeric" {...register('accountNo')} />
          </FormField>
          <FormField label="Bank" error={errors.bankName?.message}>
            <input className="input" {...register('bankName')} />
          </FormField>
          <FormField label="Branch" error={errors.branch?.message}>
            <input className="input" {...register('branch')} />
          </FormField>
          <FormField label="IFSC" error={errors.ifsc?.message}>
            <input className="input mono upper" {...register('ifsc')} />
          </FormField>
          <FormField label="SWIFT" error={errors.swift?.message} hint="Optional: for payments from abroad.">
            <input className="input mono upper" {...register('swift')} />
          </FormField>
        </div>
      </fieldset>

      {bankError && <div className="alert alert-bad">Bank: {bankError}</div>}
      {update.error && !errorBody(update.error)?.issues && <div className="alert alert-bad">{errorText(update.error)}</div>}
      <div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!formState.isDirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  )
}

/** The invoice's terms, one per line (0009 Decision 8). */
function TermsSection({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const terms = useInvoiceTerms()
  const save = useSaveInvoiceTerms()
  const [draft, setDraft] = useState<string | null>(null)
  const saved = (terms.data?.lines ?? []).join('\n')
  const text = draft ?? saved
  const issues = errorBody(save.error)?.issues

  return (
    <div className="company-section company-terms">
      <span className="lbl">Invoice terms</span>
      {terms.isPending ? (
        <p className="muted small">Loading…</p>
      ) : canEdit ? (
        <>
          <textarea className="input textarea" rows={6} value={text} onChange={(e) => setDraft(e.target.value)} aria-label="Invoice terms, one per line" />
          <span className="muted small">One term per line, up to 10. Printed at the foot of every invoice.</span>
          {(issues?.lines?.[0] ?? (save.error && errorText(save.error))) && <div className="alert alert-bad">{issues?.lines?.[0] ?? errorText(save.error)}</div>}
          <div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={draft === null || draft === saved || save.isPending}
              onClick={() =>
                save.mutate(
                  { lines: text.split('\n') },
                  {
                    onSuccess: () => {
                      setDraft(null)
                      toast({ tone: 'ok', message: 'Invoice terms saved.' })
                    },
                  },
                )
              }
            >
              {save.isPending ? 'Saving…' : 'Save terms'}
            </button>
          </div>
        </>
      ) : (
        <ol className="company-terms-list">
          {(terms.data?.lines ?? []).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** The logo or the signature: a preview, who uploaded it, and Upload / Replace for the Head. */
function ImageTile({ kind, label, image, canEdit, note }: { kind: CompanyImageKind; label: string; image: CompanyImage | null; canEdit: boolean; note?: string }) {
  const toast = useToast()
  const upload = useUploadCompanyImage(kind)
  const link = useCompanyImageLink(kind, !!image)
  const input = useRef<HTMLInputElement>(null)

  const send = (file: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again still triggers a change
    if (!file) return
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast({ tone: 'bad', message: `${file.name} isn’t a PNG or JPEG image.` })
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast({ tone: 'bad', message: `${file.name} is over 2 MB. Save it smaller and upload it again.` })
      return
    }
    upload.mutate(file, {
      onSuccess: () => toast({ tone: 'ok', message: `${label} saved.` }),
      onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? `Couldn’t upload the ${label.toLowerCase()}. Please try again.` }),
    })
  }

  return (
    <div className="company-image">
      <span className="lbl">{label}</span>
      <div className="company-image-box">
        {image && link.data ? <img src={link.data.url} alt={`Masti’s ${label.toLowerCase()}`} /> : <span className="muted small">{image ? 'Loading…' : 'Not uploaded yet'}</span>}
      </div>
      {image && (
        <span className="muted small">
          {image.uploadedBy.name}, {formatDateTime(image.uploadedAt)}
        </span>
      )}
      {note && <span className="muted small">{note}</span>}
      {canEdit && (
        <>
          <button type="button" className="btn btn-sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : image ? 'Replace' : 'Upload'}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            aria-label={`${label} image`}
            onChange={(e) => send(e.target.files?.[0])}
          />
          <span className="muted small">PNG or JPEG, up to 2 MB</span>
        </>
      )}
    </div>
  )
}
