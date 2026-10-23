import { Link } from 'react-router'
import { canViewVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { HolidayCalendarCard } from './holidays/HolidayCalendarCard'
import { HolidaySettingsCard } from './holidays/HolidaySettingsCard'
import { sinceDay } from './consentWording/labels'
import { ReminderRulesCard } from './ReminderRulesCard'
import { useConsentFields, useConsentWordings, useCoveringLetters, useMasterList, useOfferings } from './queries'

/** Masters on the demo that aren't built yet. Shown greyed out, like Phase-2 items in the sidebar. */
const NOT_BUILT = ['Hotels — minimum markup', 'Accounts routine tasks']

/**
 * Settings → Masters & holiday calendar (demo screen 29): "The lists and rules the rest of the system reads from."
 * Everyone in the office can read them; the Head and HODs change them (per master, see auth/permissions.ts).
 */
export function MastersPage() {
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false

  const offerings = useOfferings(visa)
  const countries = useMasterList('countries', visa)
  const visaTypes = useMasterList('visa-types', visa)
  const documents = useMasterList('documents', visa)
  const problems = useMasterList('document-problem-reasons', visa)
  const sources = useMasterList('enquiry-sources', visa)
  const embassies = useMasterList('embassies')
  const outcomes = useMasterList('follow-up-outcomes')
  const nextSteps = useMasterList('follow-up-next-steps')
  const reasons = useMasterList('enquiry-reasons')
  const vendors = useMasterList('vendors', visa)
  const letters = useCoveringLetters(visa)
  const consentInUse = useConsentWordings(visa).data?.[0]
  const consentFields = useConsentFields(visa)

  const active = (rows: { isActive: boolean }[] | undefined) => (rows ? String(rows.filter((r) => r.isActive).length) : '…')

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Masters</h1>
          <p>The lists and rules the rest of the system reads from. Only Vimal and HODs can change them.</p>
        </div>
      </div>

      <HolidayCalendarCard />

      <div className="masters-grid">
        {visa && (
          <section className="card pad master-card">
            <h2 className="h2">Document checklists</h2>
            <p className="muted small">What each visa needs, for adults and children: picked at intake and copied onto each traveller.</p>
            <div className="kv-line">
              <span>Country × visa type</span>
              <strong>{active(offerings.data)}</strong>
            </div>
            <Link to="/settings/masters/checklists" className="btn btn-sm">
              Open checklists
            </Link>
          </section>
        )}

        {visa && (
          <section className="card pad master-card">
            <h2 className="h2">Covering letters</h2>
            <p className="muted small">
              The fixed letter to the embassy for each visa and who travels, filled in from the case and printed on the client’s
              letterhead.
            </p>
            <div className="kv-line">
              <span>Fixed formats</span>
              <strong>{active(letters.data)}</strong>
            </div>
            <Link to="/settings/masters/covering-letters" className="btn btn-sm">
              Open covering letters
            </Link>
          </section>
        )}

        {visa && (
          <section className="card pad master-card">
            <h2 className="h2">Consent &amp; liability form</h2>
            <p className="muted small">
              The words clients agree to with “I agree” on the link we send them, once in their life for every visa, and
              the details staff ask them for.
            </p>
            <div className="kv-line">
              <span>Wording in use since</span>
              <strong>{consentInUse ? sinceDay(consentInUse.createdAt) : '…'}</strong>
            </div>
            <div className="kv-line">
              <span>Fields on the form</span>
              <strong>{active(consentFields.data)}</strong>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/settings/masters/consent-wording" className="btn btn-sm">
                Open consent wording
              </Link>
              <Link to="/settings/masters/consent-fields" className="btn btn-sm">
                Open form fields
              </Link>
            </div>
          </section>
        )}

        <section className="card pad master-card">
          <h2 className="h2">Lists</h2>
          <p className="muted small">The building blocks the checklists, the holiday calendar and the New enquiry form use.</p>
          {visa && (
            <>
              <Link className="kv-line" to="/settings/masters/lists?tab=countries">
                <span>Countries</span>
                <strong>{active(countries.data)}</strong>
              </Link>
              <Link className="kv-line" to="/settings/masters/lists?tab=visa-types">
                <span>Visa types</span>
                <strong>{active(visaTypes.data)}</strong>
              </Link>
              <Link className="kv-line" to="/settings/masters/lists?tab=documents">
                <span>Documents</span>
                <strong>{active(documents.data)}</strong>
              </Link>
              <Link className="kv-line" to="/settings/masters/lists?tab=document-problem-reasons">
                <span>Document problems</span>
                <strong>{active(problems.data)}</strong>
              </Link>
              <Link className="kv-line" to="/settings/masters/lists?tab=enquiry-sources">
                <span>Enquiry sources</span>
                <strong>{active(sources.data)}</strong>
              </Link>
            </>
          )}
          <Link className="kv-line" to="/settings/masters/lists?tab=embassies">
            <span>Embassies &amp; visa centres</span>
            <strong>{active(embassies.data)}</strong>
          </Link>
        </section>

        <section className="card pad master-card">
          <h2 className="h2">Follow-ups &amp; reasons</h2>
          <p className="muted small">The dropdowns on every case. No free text anywhere: reports count these.</p>
          <Link className="kv-line" to="/settings/masters/lists?tab=follow-up-outcomes">
            <span>What happened</span>
            <strong>{active(outcomes.data)}</strong>
          </Link>
          <Link className="kv-line" to="/settings/masters/lists?tab=follow-up-next-steps">
            <span>Next steps</span>
            <strong>{active(nextSteps.data)}</strong>
          </Link>
          <Link className="kv-line" to="/settings/masters/lists?tab=enquiry-reasons">
            <span>Postpone &amp; cancel reasons</span>
            <strong>{active(reasons.data)}</strong>
          </Link>
        </section>

        {visa && (
          <section className="card pad master-card">
            <h2 className="h2">Vendors</h2>
            <p className="muted small">Visa submission agents and the countries they cover. Staff can only pick active vendors; only the Head and the Visa HOD add them.</p>
            <Link className="kv-line" to="/settings/masters/lists?tab=vendors">
              <span>Active vendors</span>
              <strong>{active(vendors.data)}</strong>
            </Link>
          </section>
        )}

        <HolidaySettingsCard />
        {visa && <ReminderRulesCard />}

        {NOT_BUILT.map((name) => (
          <section key={name} className="card pad master-card master-card-soon" aria-disabled="true">
            <h2 className="h2">
              {name} <span className="tag">Soon</span>
            </h2>
            <p className="muted small">Comes with a later step.</p>
          </section>
        ))}
      </div>
    </>
  )
}
