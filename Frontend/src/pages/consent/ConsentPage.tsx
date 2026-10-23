import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { ConsentWording } from '../../components/ConsentWording'
import { ServerUnreachableError } from '../../lib/api'
import { issueText } from '../../lib/apiErrors'
import '../../styles/consent.css'
import { dateTimeWithYear, detailRows } from './details'
import { formChanged, useAgreeConsent, useConsentView, type ConsentCompany, type ConsentView } from './queries'

const NOT_VALID = "This link isn't valid. Please use the link in Masti Tours & Travels' WhatsApp message."

/** What went wrong, in plain words: the server's own message (a link that isn't valid, or was replaced), or a fallback. */
const problemText = (error: unknown) => issueText(error) ?? 'Something went wrong. Please try again.'

/** A number the phone can call: "+91-93777-57580" → tel:+919377757580. */
function Phone({ phone }: { phone: string }) {
  return <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>
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
        {name}’s consent was recorded on {dateTimeWithYear(agreedAt)}.
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
        {/* A child: their parent or guardian agrees for them (docs/decisions/0022-consent-form.md amendment 2). */}
        {person.guardian && (
          <p className="consent-lead">
            <strong>{person.guardian.name}</strong>, you agree to this form on behalf of {person.name}, as their parent or
            guardian.
          </p>
        )}
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
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
          {person.guardian ? `I have read this form, and I agree on ${person.name}’s behalf.` : 'I have read this form.'}
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
