import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import type { CaseTraveller, VisaCase } from '../types'
import { ConsentDetailsDialog } from './ConsentDetailsDialog'
import { dayMonth, travellerTab } from './labels'

/** Where the details can be filled in (0022): not at enquiry, then alongside processing until the handover. */
const CONSENT_STAGES = ['DOCUMENTS', 'FILE_PREPARATION', 'DISPATCH', 'AT_VENDOR', 'DECISION', 'PASSPORT_BACK']

/** "Agreed · 28 Sep" or "None on file — flagged", with the details' state; or "Name this traveller first". */
function Tile({ traveller, onFill }: { traveller: CaseTraveller; onFill: (() => void) | null }) {
  const { name } = travellerTab(traveller)
  const { consent } = traveller
  if (consent.state === 'UNLINKED') {
    return (
      <div className="consent-tile">
        <strong>{name}</strong>
        <span className="muted">Name this traveller first</span>
      </div>
    )
  }
  const filled = consent.details.filledAt
  return (
    <div className={`consent-tile ${consent.state === 'ON_FILE' ? 'ok' : 'flagged'}`}>
      <strong>{name}</strong>
      {consent.state === 'ON_FILE' ? `Agreed · ${dayMonth(consent.agreedAt)}` : 'None on file — flagged'}
      <span className="small">{filled ? `Details filled · ${dayMonth(filled)}` : 'Details not filled'}</span>
      {onFill && (
        <button type="button" className="btn btn-sm consent-fill" onClick={onFill}>
          {filled ? 'Edit details' : 'Fill details'}
        </button>
      )}
    </div>
  )
}

/**
 * The consent & liability form (§10.5, docs/decisions/0022-consent-form.md): once per person, for life. Taken in
 * parallel with processing, so it never blocks the case. Staff fill in each traveller's details here (part 1); the
 * client's "I agree" link comes next (part 2).
 */
export function ConsentCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [filling, setFilling] = useState<CaseTraveller | null>(null)
  const canFill =
    !!me && c.status === 'OPEN' && CONSENT_STAGES.includes(c.stage.code) && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad">
      <div className="card-head" style={{ paddingBottom: 4 }}>
        <h2 className="h2">Consent &amp; liability form</h2>
        <span className="muted small">once per person · stays valid if the passport changes</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Staff fill the details by asking the client (dates of birth, anniversary, parents’ dates of birth, addresses, income,
        profession, education). The client then only taps <strong>I agree</strong> on a WhatsApp link: that part comes next.
      </p>
      <div className="consent-tiles">
        {c.travellers.map((t) => (
          <Tile key={t.id} traveller={t} onFill={canFill && t.consent.state !== 'UNLINKED' ? () => setFilling(t) : null} />
        ))}
      </div>
      {filling && filling.consent.state !== 'UNLINKED' && (
        <ConsentDetailsDialog caseNo={c.caseNo} traveller={filling} details={filling.consent.details} onClose={() => setFilling(null)} />
      )}
    </section>
  )
}
