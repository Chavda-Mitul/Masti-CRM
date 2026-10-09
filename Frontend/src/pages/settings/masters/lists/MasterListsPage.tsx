import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { canEditEmbassies, canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { CountriesTable } from './CountriesTable'
import { DocumentsTable } from './DocumentsTable'
import { EmbassiesTable } from './EmbassiesTable'
import { VisaTypesTable } from './VisaTypesTable'

type ListTab = 'countries' | 'visa-types' | 'embassies' | 'documents'

const TABS: { value: ListTab; label: string; visa: boolean }[] = [
  { value: 'countries', label: 'Countries', visa: true },
  { value: 'visa-types', label: 'Visa types', visa: true },
  { value: 'embassies', label: 'Embassies & visa centres', visa: false },
  { value: 'documents', label: 'Documents', visa: true },
]

/**
 * The small master lists, one tab each (?tab=…). Countries, visa types and documents are the Visa department's
 * (read with Visa access, changed by the Visa HOD or the Head); embassies are shared (changed by any HOD).
 */
export function MasterListsPage() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const [showInactive, setShowInactive] = useState(false)
  if (!me) return null

  const visa = canViewVisaMasters(me)
  const tabs = TABS.filter((t) => visa || !t.visa)
  const tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? tabs[0]!.value
  const canEdit = tab === 'embassies' ? canEditEmbassies(me) : canEditVisaMasters(me)

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/settings/masters" className="back-link">
            ‹ Masters
          </Link>
          <h1 className="h1">Lists</h1>
          <p>
            Switched-off entries disappear from dropdowns but stay on old cases and in reports.
            {!canEdit && ' You can look, but only ' + (tab === 'embassies' ? 'the Head and HODs' : 'the Head and the Visa HOD') + ' can change these.'}
          </p>
        </div>
      </div>

      <div className="list-tools">
        <div className="kind-toggle" role="tablist" aria-label="Which list">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={tab === t.value ? 'on' : ''}
              onClick={() => setParams({ tab: t.value }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show switched-off
        </label>
      </div>

      {tab === 'countries' && <CountriesTable canEdit={canEdit} showInactive={showInactive} />}
      {tab === 'visa-types' && <VisaTypesTable canEdit={canEdit} showInactive={showInactive} />}
      {tab === 'embassies' && <EmbassiesTable canEdit={canEdit} showInactive={showInactive} />}
      {tab === 'documents' && <DocumentsTable canEdit={canEdit} showInactive={showInactive} />}
    </>
  )
}
