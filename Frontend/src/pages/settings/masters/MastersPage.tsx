import { Link } from 'react-router'
import { canViewVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { HolidayCalendarCard } from './holidays/HolidayCalendarCard'
import { HolidaySettingsCard } from './holidays/HolidaySettingsCard'
import { useMasterList, useOfferings } from './queries'

/** Masters on the demo that aren't built yet. Shown greyed out, like Phase-2 items in the sidebar. */
const NOT_BUILT = ['Reminder rules', 'Vendors', 'Hotels — minimum markup', 'Dropdown reasons', 'Covering letters', 'Accounts routine tasks']

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
  const embassies = useMasterList('embassies')

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

        <section className="card pad master-card">
          <h2 className="h2">Lists</h2>
          <p className="muted small">The building blocks the checklists and the holiday calendar use.</p>
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
            </>
          )}
          <Link className="kv-line" to="/settings/masters/lists?tab=embassies">
            <span>Embassies &amp; visa centres</span>
            <strong>{active(embassies.data)}</strong>
          </Link>
        </section>

        <HolidaySettingsCard />

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
