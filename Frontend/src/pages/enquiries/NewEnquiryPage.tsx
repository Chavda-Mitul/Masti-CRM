import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router'
import { can } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormField, RequiredMark } from '../../components/FormField'
import { applyServerIssues, errorText } from '../../lib/apiErrors'
import { DEPARTMENT_STYLE, departmentStyle, SELLING_DEPARTMENTS } from '../../lib/departments'
import { istToday } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import '../../styles/enquiries.css'
import { normaliseMobile } from '../clients/schemas'
import { useClientLookup, useCreateVisaCase, useEnquirySources, useVisaIntakeOfferings } from './queries'
import { emptyVisaEnquiry, MAX_ADULTS, MAX_CHILDREN, toCreateVisaCaseBody, visaEnquiryFormSchema, type VisaEnquiryFormValues } from './schemas'

const FIELDS = ['mobile', 'clientName', 'sourceCode', 'offeringId', 'adults', 'children', 'travelMonth', 'travelDate'] as const

/** A fresh key per form, so a retried or double-clicked save returns the same case. Works over plain HTTP too. */
function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** "2026-12" → last day "2026-12-31", for the travel date picker. */
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

/**
 * New enquiry (demo screen 05), filled in by hand: the AI "Fill in from a message" comes later.
 * Only what the client tells us now; names, documents and the rest come in Step 2.
 * Saving goes to All enquiries. ?mobile= prefills the number (from a client's profile).
 */
export function NewEnquiryPage() {
  const { data: me } = useMe()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const sources = useEnquirySources()
  const offerings = useVisaIntakeOfferings()
  const save = useCreateVisaCase(idempotencyKey)

  const form = useForm<VisaEnquiryFormValues>({
    resolver: zodResolver(visaEnquiryFormSchema),
    defaultValues: emptyVisaEnquiry(params.get('mobile') ?? ''),
  })
  const { control, register, handleSubmit, setError, setValue, resetField, formState } = form
  const { errors } = formState
  const [mobile, countryId, travelMonth] = useWatch({ control, name: ['mobile', 'countryId', 'travelMonth'] })

  // "WhatsApp" first ⚠️ (the demo's default): the first source by the master's order. Not a change by the user.
  const firstSource = sources.data?.[0]?.code
  useEffect(() => {
    if (firstSource && !form.getValues('sourceCode')) resetField('sourceCode', { defaultValue: firstSource })
  }, [firstSource, form, resetField])

  const lookupMobile = useDebouncedValue(normaliseMobile(mobile), 300)
  const lookup = useClientLookup(lookupMobile)

  // The Client name field appears only once the lookup says the number is new. Tab pressed on a complete number
  // before that would skip it (focus landed on "WhatsApp"), so focus moves to it when it appears.
  const nameAfterTab = useRef(false)
  const lookupAnswered = lookup.data !== undefined && lookupMobile === normaliseMobile(mobile)
  useEffect(() => {
    if (!nameAfterTab.current || !lookupAnswered) return
    nameAfterTab.current = false
    if (!lookup.data?.client) form.setFocus('clientName')
  }, [lookupAnswered, lookup.data, form])

  const country = offerings.data?.find((c) => String(c.id) === countryId)
  // One visa type for the country: pick it.
  useEffect(() => {
    if (country?.visaTypes.length === 1) setValue('offeringId', String(country.visaTypes[0]!.offeringId), { shouldValidate: formState.isSubmitted })
  }, [country, setValue, formState.isSubmitted])

  // Leaving with something typed asks first (not after saving, and not when logging out).
  const savedCase = save.data?.case
  const dirty = formState.isDirty && !savedCase
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && nextLocation.pathname !== currentLocation.pathname && nextLocation.pathname !== '/login',
  )
  // Saved: go to the list once the blocker has seen it, with the new case open in the side panel.
  useEffect(() => {
    if (savedCase) navigate('/enquiries', { state: { selected: savedCase.id } })
  }, [savedCase, navigate])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!me) return null
  if (!can(me, 'VISA', 'EDIT')) {
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <h1 className="h2">New enquiry</h1>
        <p className="muted">You need edit access to Visa to record an enquiry. Ask your HOD.</p>
      </div>
    )
  }

  const found = lookup.data?.client
  const openEnquiries = lookup.data?.openEnquiries ?? []
  // A new number: the name is required (9 Oct 2026).
  const needsName = lookup.data !== undefined && !found

  const onSubmit = handleSubmit((values) => {
    if (needsName && !values.clientName.trim()) {
      setError('clientName', { type: 'required', message: "Enter the client's name." }, { shouldFocus: true })
      return
    }
    save.mutate(toCreateVisaCaseBody(values), {
      onSuccess: ({ case: c }) => {
        toast({ tone: 'ok', message: `Enquiry ${c.caseNo} saved for ${c.client.name}.` })
      },
      onError: (err) => applyServerIssues(err, setError, FIELDS),
    })
  })

  const thisMonth = istToday().slice(0, 7)
  const visa = departmentStyle('VISA')
  const message = errorText(save.error)

  return (
    <form onSubmit={onSubmit} noValidate className="new-enquiry">
      <div className="page-head">
        <div>
          <Link to="/enquiries" className="back-link">
            ‹ All enquiries
          </Link>
          <h1 className="h1">New enquiry</h1>
          <p>Take only what the client tells you now (fields marked * are needed). Travellers' names, travel details and documents come in with the documents.</p>
        </div>
      </div>

      <section className="card pad enquiry-card">
        <div className="card-title-row">
          <h2 className="h2">Who is asking</h2>
          {found ? (
            <span className="chip chip-ok">
              Existing client · {found.name}
              {found.matchedOn === 'SECONDARY' && ' (extra number)'}
            </span>
          ) : lookup.data ? (
            <span className="chip chip-info">New client · saved against this number</span>
          ) : null}
        </div>

        <div className="who-fields">
          <FormField label="Mobile number" required error={errors.mobile?.message}>
            <input
              className="input mobile-input"
              inputMode="tel"
              autoComplete="off"
              placeholder="98250 41234"
              autoFocus
              aria-required
              {...register('mobile')}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && !e.shiftKey && !lookupAnswered && normaliseMobile(e.currentTarget.value)) nameAfterTab.current = true
              }}
            />
          </FormField>
          {needsName && (
            <FormField
              label="Client name"
              required
              error={errors.clientName?.message}
              hint={found ? 'This client was saved without a name. Add it now.' : 'A new client, saved against this number.'}
            >
              <input className="input mobile-input" autoComplete="off" placeholder="Rakesh Mehta" aria-required {...register('clientName')} />
            </FormField>
          )}
        </div>

        {/* Warns, doesn't block: a family can plan two trips (0003). */}
        {found && openEnquiries.length > 0 && (
          <div className="alert alert-warn open-cases" role="status">
            <strong>
              {found.name} already has {openEnquiries.length === 1 ? 'an open case' : `${openEnquiries.length} open cases`}.
            </strong>{' '}
            Check it isn't the same trip before saving a new one.
            <ul>
              {openEnquiries.map((e) => (
                <li key={e.caseNo}>
                  <Link to={`/enquiries?q=${encodeURIComponent(e.caseNo)}`} target="_blank" rel="noreferrer">
                    {e.caseNo}
                  </Link>{' '}
                  · {departmentStyle(e.department).label} · {e.summary} · {e.stage}
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset className="enq-fieldset">
          <legend className="lbl">
            Came in through
            <RequiredMark />
          </legend>
          {sources.isError ? (
            <div className="alert alert-bad">{errorText(sources.error)}</div>
          ) : (
            <Controller
              control={control}
              name="sourceCode"
              render={({ field }) => (
                <div className="pill-group" role="radiogroup" aria-label="Came in through">
                  {(sources.data ?? []).map((s) => (
                    <label key={s.code} className={`pill${field.value === s.code ? ' on' : ''}`}>
                      <input type="radio" className="sr-only" name={field.name} value={s.code} checked={field.value === s.code} onChange={() => field.onChange(s.code)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            />
          )}
          {errors.sourceCode && <span className="field-error">{errors.sourceCode.message}</span>}
        </fieldset>

        <fieldset className="enq-fieldset">
          <legend className="lbl">What do they want?</legend>
          {/* Only Visa intake is built; the others come with their departments in Stage 2. */}
          <div className="pill-group">
            {SELLING_DEPARTMENTS.map((code) => {
              const style = DEPARTMENT_STYLE[code]!
              const on = code === 'VISA'
              return (
                <span
                  key={code}
                  className={`pill pill-lg${on ? ' on' : ' pill-off'}`}
                  aria-disabled={!on}
                  title={on ? undefined : 'Comes with that department, in a later stage'}
                >
                  <span className="dot" style={{ background: style.solid }} />
                  {style.label}
                  {!on && <span className="tag">Soon</span>}
                </span>
              )
            })}
          </div>
        </fieldset>
      </section>

      <section className="card pad enquiry-card" style={{ borderTop: `4px solid ${visa.solid}` }}>
        <div className="card-title-row">
          <h2 className="h2">Visa — just four things</h2>
          <span className="chip" style={{ background: visa.tint, color: visa.text }}>
            Visa
          </span>
        </div>

        {offerings.isError && <div className="alert alert-bad">{errorText(offerings.error)}</div>}
        {offerings.data?.length === 0 && (
          <div className="alert alert-warn">No visa has a document checklist yet. Set one up in Settings → Masters → Document checklists.</div>
        )}

        <div className="form-grid">
          <FormField label="Country" required error={errors.countryId?.message}>
            <select
              className="select"
              {...register('countryId', { onChange: () => setValue('offeringId', '') })}
              disabled={!offerings.data}
            >
              <option value="">{offerings.isPending ? 'Loading…' : 'Choose a country'}</option>
              {offerings.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Visa type" required error={errors.offeringId?.message}>
            <select className="select" {...register('offeringId')} disabled={!country}>
              <option value="">Choose a type</option>
              {country?.visaTypes.map((t) => (
                <option key={t.offeringId} value={t.offeringId}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>

          <Controller
            control={control}
            name="adults"
            render={({ field }) => (
              <Stepper label="Adults" required one="adult" min={1} max={MAX_ADULTS} value={field.value} onChange={field.onChange} error={errors.adults?.message} />
            )}
          />
          <Controller
            control={control}
            name="children"
            render={({ field }) => (
              <Stepper label="Children" one="child" min={0} max={MAX_CHILDREN} value={field.value} onChange={field.onChange} error={errors.children?.message} />
            )}
          />

          <FormField label="Travel month" required error={errors.travelMonth?.message}>
            <input className="input" type="month" min={thisMonth} {...register('travelMonth', { onChange: () => setValue('travelDate', '') })} />
          </FormField>
          <FormField label="Travel date (if they know it)" error={errors.travelDate?.message} hint="Optional.">
            <input
              className="input"
              type="date"
              disabled={!travelMonth}
              min={travelMonth ? (travelMonth === thisMonth ? istToday() : `${travelMonth}-01`) : undefined}
              max={travelMonth ? lastDayOf(travelMonth) : undefined}
              {...register('travelDate')}
            />
          </FormField>
        </div>

        <p className="muted small" style={{ margin: '14px 0 0' }}>
          Names, duration and single/multiple entry are filled in later, when the documents come in.
        </p>
      </section>

      {message && (
        <div className="alert alert-bad" role="alert">
          {message}
        </div>
      )}

      <div className="enquiry-actions">
        <button type="submit" className="btn btn-primary btn-lg" disabled={save.isPending || !offerings.data || !sources.data}>
          {save.isPending ? 'Saving…' : 'Save enquiry'}
        </button>
        <Link to="/enquiries" className="btn btn-lg">
          Cancel
        </Link>
      </div>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Leave without saving?"
          body="This enquiry hasn't been saved."
          confirmLabel="Leave"
          danger
          pending={false}
          error={null}
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      )}
    </form>
  )
}

/** −  2  + : the demo's adults/children counter. */
function Stepper({
  label,
  required,
  one,
  min,
  max,
  value,
  onChange,
  error,
}: {
  label: string
  required?: boolean
  one: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
  error?: string | undefined
}) {
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <span>
        {label}
        {required && <RequiredMark />}
      </span>
      <div className="stepper">
        <button type="button" className="btn" aria-label={`One less ${one}`} onClick={() => onChange(value - 1)} disabled={value <= min}>
          −
        </button>
        <output aria-live="polite" aria-label={label}>
          {value}
        </output>
        <button type="button" className="btn" aria-label={`One more ${one}`} onClick={() => onChange(value + 1)} disabled={value >= max}>
          +
        </button>
      </div>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
