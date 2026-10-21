import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { ConsentWording } from '../../components/ConsentWording'
import { ServerUnreachableError } from '../../lib/api'
import { issueText } from '../../lib/apiErrors'
import { formatDate } from '../../lib/format'
import '../../styles/consent.css'
import { formChanged, useAgreeConsent, useConsentView, type ConsentCompany, type ConsentPerson, type ConsentView } from './queries'

const NOT_VALID = "This link isn't valid. Please use the link in Masti Tours & Travels' WhatsApp message."

const WHOLE_RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

/** "21 Oct 2026, 3:45 pm" in Indian time. */
function agreedOn(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
    .format(new Date(iso))
    .replace(/\bAM\b/i, 'am')
    .replace(/\bPM\b/i, 'pm')
}

/** What went wrong, in plain words: the server's own message (a link that isn't valid, or was replaced), or a fallback. */
const problemText = (error: unknown) => issueText(error) ?? 'Something went wrong. Please try again.'

/** A number the phone can call: "+91-93777-57580" → tel:+919377757580. */
function Phone({ phone }: { phone: string }) {
  return <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>
}

/** The filled details in the form's order; what doesn't apply (a child's income) stays out. */
function detailRows(p: ConsentPerson): [string, string][] {
  const day = (value: string | null) => (value ? formatDate(value) : null)
  const rows: [string, string | null][] = [
    ['Passport number', p.passportNumber],
    ['Date of birth', day(p.dateOfBirth)],
    ['Spouse’s date of birth', day(p.spouseDateOfBirth)],
    ['Anniversary', day(p.anniversary)],
    ['Mother’s date of birth', day(p.motherDateOfBirth)],
    ['Father’s date of birth', day(p.fatherDateOfBirth)],
    ['Home address', p.residentialAddress],
    ['Office address', p.officeAddress],
    ['Profession', p.profession],
    ['Annual income', p.annualIncome === null ? null : WHOLE_RUPEES.format(p.annualIncome)],
    ['Education', p.education],
  ]
  return rows.filter((row): row is [string, string] => !!row[1])
}

function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="card pad consent-state">
      <h1 className="h2">We couldn’t open the form</h1>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  )
}

function Thanks({ name, agreedAt }: { name: string; agreedAt: string }) {
  return (
    <section className="card pad consent-state">
      <div className="consent-thanks-mark" aria-hidden="true">
        ✓
      </div>
      <h1 className="h2">Thank you</h1>
      <p>
        {name}’s consent was recorded on {agreedOn(agreedAt)}.
      </p>
      <p className="muted">There’s nothing more to do. You can close this page.</p>
    </section>
  )
}

/** The form: who it's for, their details, the wording, then the tick and "I agree". */
function OpenForm({
  view,
  agree,
}: {
  view: Extract<ConsentView, { state: 'OPEN' }>
  agree: ReturnType<typeof useAgreeConsent>
}) {
  const { person, detailsHash, wording, company } = view
  const [read, setRead] = useState(false)
  const message = agree.error ? problemText(agree.error) : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (read) agree.mutate({ wordingId: wording.id, detailsHash })
  }

  return (
    <>
      <section className="card pad">
        <div className="lbl">Consent and liability form</div>
        <h1 className="h1 consent-name">{person.name}</h1>
        <p className="muted consent-lead">
          Please check the details, read the form and tap <strong>I agree</strong> at the end.
        </p>
      </section>

      <section className="card pad">
        <h2 className="h2">Details given to us</h2>
        <dl className="consent-person">
          {detailRows(person).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small consent-lead">
          Something wrong? Call us on <Phone phone={company.phone} /> before you agree.
        </p>
      </section>

      <ConsentWording body={wording.body} />

      <form className="card pad consent-agree" onSubmit={submit}>
        <label className="check consent-check">
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />I have read this form.
        </label>
        {message && (
          <div className={`alert ${formChanged(agree.error) ? 'alert-warn' : 'alert-bad'}`} role="alert">
            {message}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={!read || agree.isPending}>
          {agree.isPending ? 'Saving…' : 'I agree'}
        </button>
      </form>
    </>
  )
}

function Footer({ company }: { company: ConsentCompany }) {
  return (
    <footer className="consent-foot">
      <strong>{company.name}</strong>
      <span>{company.address}</span>
      <span>
        <Phone phone={company.phone} />
        {company.phone2 && (
          <>
            {' · '}
            <Phone phone={company.phone2} /> (24/7)
          </>
        )}
      </span>
    </footer>
  )
}

/**
 * The consent & liability form as the client sees it (docs/decisions/0022-consent-form.md, part 2): opened from the
 * WhatsApp link, mostly on a phone, with no login. The secret is after the # in the link, which browsers never send to
 * a server, and this page posts it in the body; so no log holds it. The client checks their details, reads the form
 * and taps "I agree", once.
 */
export function ConsentPage() {
  const { hash } = useLocation()
  const token = hash.slice(1)
  const view = useConsentView(token)
  const agree = useAgreeConsent(token)

  useEffect(() => {
    const before = document.title
    document.title = 'Consent form · Masti Tours & Travels'
    return () => {
      document.title = before
    }
  }, [])

  let content: ReactNode
  if (!token) content = <Problem message={NOT_VALID} />
  else if (view.isPending) content = <p className="consent-state muted">Opening the form…</p>
  else if (view.isError) {
    const retry = view.error instanceof ServerUnreachableError ? () => void view.refetch() : undefined
    content = <Problem message={problemText(view.error)} onRetry={retry} />
  } else if (view.data.state === 'AGREED') content = <Thanks name={view.data.name} agreedAt={view.data.agreedAt} />
  // A form that changed while they read it (new wording or details) starts the tick again.
  else content = <OpenForm key={`${view.data.wording.id}:${view.data.detailsHash}`} view={view.data} agree={agree} />

  return (
    <div className="consent-page">
      <main className="consent-sheet">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">Masti Travels</div>
            <div className="brand-sub">Tours &amp; Travels · Surat</div>
          </div>
        </div>
        {content}
        {view.data && <Footer company={view.data.company} />}
      </main>
    </div>
  )
}
