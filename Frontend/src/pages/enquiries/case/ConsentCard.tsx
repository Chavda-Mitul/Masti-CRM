import type { CaseTraveller, VisaCase } from '../types'
import { dayMonth, travellerTab } from './labels'

/** "Agreed · 28 Sep", "None on file — flagged", or "Name this traveller first". */
function Tile({ traveller }: { traveller: CaseTraveller }) {
  const { name } = travellerTab(traveller)
  const { consent } = traveller
  if (consent.state === 'ON_FILE') {
    return (
      <div className="consent-tile ok">
        <strong>{name}</strong>
        Agreed · {dayMonth(consent.agreedAt)}
      </div>
    )
  }
  if (consent.state === 'NONE') {
    return (
      <div className="consent-tile flagged">
        <strong>{name}</strong>
        None on file — flagged
      </div>
    )
  }
  return (
    <div className="consent-tile">
      <strong>{name}</strong>
      <span className="muted">Name this traveller first</span>
    </div>
  )
}

/**
 * The consent & liability form (§10.5): once per person, for life. Taken in parallel with processing, so it never blocks
 * the case. The "I agree" link that fills it comes with WhatsApp (0006 Decision 5).
 */
export function ConsentCard({ visaCase: c }: { visaCase: VisaCase }) {
  return (
    <section className="card pad">
      <div className="card-head" style={{ paddingBottom: 4 }}>
        <h2 className="h2">Consent &amp; liability form</h2>
        <span className="muted small">once per person · stays valid if the passport changes</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Staff fill the details by asking the client (dates of birth, anniversary, parents’ dates of birth, addresses, income,
        profession, education). The client only taps <strong>I agree</strong> on the link, which comes with WhatsApp.
      </p>
      <div className="consent-tiles">
        {c.travellers.map((t) => (
          <Tile key={t.id} traveller={t} />
        ))}
      </div>
    </section>
  )
}
