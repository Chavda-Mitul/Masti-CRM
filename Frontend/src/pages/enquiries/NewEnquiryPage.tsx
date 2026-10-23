import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState, type Ref } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router'
import { can, canSeeEnquiry } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormField, RequiredMark } from '../../components/FormField'
import { applyServerIssues, errorText, lostAccess } from '../../lib/apiErrors'
import { DEPARTMENT_STYLE, departmentStyle, SELLING_DEPARTMENTS } from '../../lib/departments'
import { formatMobile, istToday } from '../../lib/format'
import { filtered, mobileChars } from '../../lib/inputFilters'
import { useToast } from '../../lib/toast'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import '../../styles/enquiries.css'
import { normaliseMobile } from '../clients/schemas'
import { useMasterList } from '../settings/masters/queries'
import { NORMAL_URGENCY } from '../settings/masters/schemas'
import { useClientLookup, useCreateVisaCase, useEnquirySources, useVisaIntakeOfferings } from './queries'
import type { FamilyMatch } from './types'
import { emptyVisaEnquiry, MAX_ADULTS, MAX_CHILDREN, toCreateVisaCaseBody, visaEnquiryFormSchema, type VisaEnquiryFormValues } from './schemas'

const FIELDS = ['mobile', 'clientName', 'sourceCode', 'offeringId', 'adults', 'children', 'travelMonth', 'travelDate', 'urgencyId'] as const

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
  const urgencyLevels = useMasterList('urgency-levels')
  const save = useCreateVisaCase(idempotencyKey)

  const form = useForm<VisaEnquiryFormValues>({
    resolver: zodResolver(visaEnquiryFormSchema),
    // No source is picked for the user: a default would quietly count every forgotten pick as WhatsApp in reports.
    defaultValues: emptyVisaEnquiry(formatMobile(params.get('mobile'))),
  })
  const { control, register, handleSubmit, setError, setValue, formState } = form
  const { errors } = formState
  const [mobile, countryId, travelMonth] = useWatch({ control, name: ['mobile', 'countryId', 'travelMonth'] })


  const lookupMobile = useDebouncedValue(normaliseMobile(mobile), 300)
  const lookup = useClientLookup(lookupMobile)

  // The Client name field appears only once the lookup says the number is new. Tab pressed on a complete number
  // before that would skip it (focus landed on "WhatsApp"), so focus moves to it when it appears.
  const nameAfterTab = useRef(false)
  const lookupAnswered = lookup.data !== undefined && lookupMobile === normaliseMobile(mobile)
  useEffect(() => {
    if (!nameAfterTab.current || !lookupAnswered) return
    nameAfterTab.current = false
    if (!lookup.data?.client && lookup.data?.familyMatches.length === 0) form.setFocus('clientName')
  }, [lookupAnswered, lookup.data, form])

  // A family member's own number (0004 amendment of 20 Oct 2026): the answer to "Use Rakesh Mehta / No, a new client"
  // holds for the number it was given for; editing the number asks again. clientId null is "No, it's a new client".
  const [familyChoice, setFamilyChoice] = useState<{ mobile: string; clientId: string | null } | null>(null)
  const nameAfterNo = useRef(false)
  useEffect(() => {
    if (!nameAfterNo.current || !familyChoice) return
    nameAfterNo.current = false
    form.setFocus('clientName')
  }, [familyChoice, form])

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
  const familyMatches = (!found && lookup.data?.familyMatches) || []
  const choice = familyChoice?.mobile === lookup.data?.mobile ? familyChoice : null
  const family = familyMatches.find((f) => f.client.id === choice?.clientId)
  const askFamily = familyMatches.length > 0 && !choice
  // The client the enquiry goes to: by the number, or the family picked with "Use …".
  const target = found ?? family?.client
  const openEnquiries = (found ? lookup.data?.openEnquiries : family?.openEnquiries) ?? []
  // A new number: the name is required (9 Oct 2026). Not while the family question waits for an answer.
  const needsName = lookup.data !== undefined && !target && !askFamily

  const onSubmit = handleSubmit((values) => {
    if (askFamily) {
      setError('mobile', { type: 'family', message: "This is a family member's number. Pick below whose file it goes on." }, { shouldFocus: true })
      return
    }
    if (needsName && !values.clientName.trim()) {
      setError('clientName', { type: 'required', message: "Enter the client's name." }, { shouldFocus: true })
      return
    }
    save.mutate(toCreateVisaCaseBody(values, family?.client.id ?? null), {
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
          ) : family ? (
            <span className="chip chip-ok">Existing client · {family.client.name} (family member's number)</span>
          ) : askFamily ? null : lookup.data ? (
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
              // Editing the number asks the family question again.
              {...filtered(register('mobile', { onChange: () => setFamilyChoice(null) }), mobileChars)}
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

        {askFamily && (
          <FamilyNumberQuestion
            matches={familyMatches}
            onUse={(clientId) => setFamilyChoice({ mobile: lookup.data!.mobile, clientId })}
            onUseMainNumber={(clientMobile) => setValue('mobile', formatMobile(clientMobile), { shouldDirty: true })}
            onNew={() => {
              nameAfterNo.current = true
              setFamilyChoice({ mobile: lookup.data!.mobile, clientId: null })
            }}
          />
        )}
        {family && (
          <p className="muted small family-saved">
            The case goes on {family.client.name}'s file, and this number is saved there as {family.members[0]!.name}'s, so
            it's found straight away next time.{' '}
            <button type="button" className="btn-link" onClick={() => setFamilyChoice(null)}>
              Change
            </button>
          </p>
        )}

        {/* Warns, doesn't block: a family can plan two trips (0003). */}
        {target && openEnquiries.length > 0 && (
          <div className="alert alert-warn open-cases" role="status">
            <strong>
              {target.name} already has {openEnquiries.length === 1 ? 'an open case' : `${openEnquiries.length} open cases`}.
            </strong>{' '}
            Check it isn't the same trip before saving a new one.
            <ul>
              {openEnquiries.map((e) => (
                <li key={e.caseNo}>
                  {/* A colleague's case is listed so nobody opens a duplicate, but only its owner, the HOD and the Head open it. */}
                  {canSeeEnquiry(me, e) ? (
                    <Link to={`/enquiries/${encodeURIComponent(e.caseNo)}`} target="_blank" rel="noreferrer">
                      {e.caseNo}
                    </Link>
                  ) : (
                    <span className="mono">{e.caseNo}</span>
                  )}{' '}
                  · {departmentStyle(e.department).label} · {e.summary} · {e.stage} · {e.owner ? `with ${e.owner.name}` : 'waiting for the HOD'}
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
          {sources.isLoadingError || lostAccess(sources) ? (
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

        {(offerings.isLoadingError || lostAccess(offerings)) && <div className="alert alert-bad">{errorText(offerings.error)}</div>}
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
            <Controller
              control={control}
              name="travelMonth"
              render={({ field }) => (
                <TravelMonthPicker
                  ref={field.ref}
                  value={field.value}
                  thisMonth={thisMonth}
                  invalid={!!errors.travelMonth}
                  onChange={(value) => {
                    field.onChange(value)
                    setValue('travelDate', '')
                  }}
                />
              )}
            />
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

        <fieldset className="enq-fieldset">
          <legend className="lbl">
            How urgent?
            <RequiredMark />
          </legend>
          {urgencyLevels.isLoadingError || lostAccess(urgencyLevels) ? (
            <div className="alert alert-bad">{errorText(urgencyLevels.error)}</div>
          ) : (
            <Controller
              control={control}
              name="urgencyId"
              render={({ field }) => (
                <div className="pill-group" role="radiogroup" aria-label="How urgent">
                  {(urgencyLevels.data ?? [])
                    .filter((l) => l.isActive)
                    .map((l) => {
                      // "" is Normal, where every enquiry starts (0003 amendment 1); every other level is urgent.
                      const normal = l.code === NORMAL_URGENCY
                      const value = normal ? '' : String(l.id)
                      const on = field.value === value
                      return (
                        <label key={l.id} className={`pill${on ? ' on' : ''}${on && !normal ? ' pill-urgent' : ''}`}>
                          <input type="radio" className="sr-only" name={field.name} value={value} checked={on} onChange={() => field.onChange(value)} />
                          {l.name}
                        </label>
                      )
                    })}
                </div>
              )}
            />
          )}
          {errors.urgencyId && <span className="field-error">{errors.urgencyId.message}</span>}
        </fieldset>

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
        <button type="submit" className="btn btn-primary btn-lg" disabled={save.isPending || !offerings.data || !sources.data || !urgencyLevels.data}>
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

/** "Aarav Mehta (Son)", or "Aarav Mehta (Son) and Diya Mehta (Daughter)". */
function memberNames(members: FamilyMatch['members']): string {
  const names = members.map((m) => `${m.name} (${m.relation})`)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]!
}

/**
 * The number is no client's own but a family member's (0004 amendment of 20 Oct 2026). "Use Rakesh Mehta" files the
 * enquiry on that client and saves the number there; a client with no room for another number offers its main number.
 */
function FamilyNumberQuestion({
  matches,
  onUse,
  onUseMainNumber,
  onNew,
}: {
  matches: FamilyMatch[]
  onUse: (clientId: string) => void
  onUseMainNumber: (clientMobile: string) => void
  onNew: () => void
}) {
  return (
    <div className="alert alert-warn family-number" role="status">
      {matches.map((m) => (
        <div key={m.client.id} className="family-number-row">
          <p>
            This number belongs to <strong>{memberNames(m.members)}</strong>, family of <strong>{m.client.name}</strong> ·{' '}
            {formatMobile(m.client.mobile)}.
            {m.extraNumbersFull && ` ${m.client.name} already has 5 extra numbers, so this one can't be saved there.`}
          </p>
          {m.extraNumbersFull ? (
            <button type="button" className="btn btn-sm" onClick={() => onUseMainNumber(m.client.mobile)}>
              Use {m.client.name}'s main number
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onUse(m.client.id)}>
              Use {m.client.name}
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={onNew}>
        No, it's a new client
      </button>
    </div>
  )
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The Year dropdown offers this year and the next two. */
const TRAVEL_YEARS_AHEAD = 2

/**
 * Travel month as two dropdowns, Month and Year: "2027-01" once both are picked, "" until then.
 * Not the browser's month box: Chrome's opens on this year with January greyed out, typing "01" there picks the
 * wrong month, and Firefox and Safari don't have one.
 */
function TravelMonthPicker({
  ref,
  value,
  thisMonth,
  invalid,
  onChange,
}: {
  ref: Ref<HTMLSelectElement>
  value: string
  /** "2026-10": months before it are greyed out. */
  thisMonth: string
  invalid: boolean
  onChange: (value: string) => void
}) {
  const [month, setMonth] = useState(value.slice(5, 7))
  const [year, setYear] = useState(value.slice(0, 4))
  const thisYear = Number(thisMonth.slice(0, 4))
  const years = Array.from({ length: TRAVEL_YEARS_AHEAD + 1 }, (_, i) => String(thisYear + i))

  const pick = (m: string, y: string) => {
    // Choosing this year after a month already past (January, then 2026) clears the month.
    const kept = m && y && `${y}-${m}` < thisMonth ? '' : m
    setMonth(kept)
    setYear(y)
    onChange(kept && y ? `${y}-${kept}` : '')
  }

  return (
    <div className="month-year">
      <select
        ref={ref}
        className="select"
        aria-label="Travel month"
        aria-required
        aria-invalid={invalid}
        value={month}
        onChange={(e) => pick(e.target.value, year)}
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => {
          const m = String(i + 1).padStart(2, '0')
          return (
            <option key={m} value={m} disabled={year !== '' && `${year}-${m}` < thisMonth}>
              {name}
            </option>
          )
        })}
      </select>
      <select className="select" aria-label="Travel year" aria-required aria-invalid={invalid} value={year} onChange={(e) => pick(month, e.target.value)}>
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
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
