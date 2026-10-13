import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { canEditEmbassies, canEditEnquiryMasters, canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import type { User } from '../../../../auth/types'
import { useMe } from '../../../../auth/useAuth'
import { CountriesTable } from './CountriesTable'
import { DocumentProblemsTable } from './DocumentProblemsTable'
import { DocumentsTable } from './DocumentsTable'
import { EmbassiesTable } from './EmbassiesTable'
import { EnquiryReasonsTable } from './EnquiryReasonsTable'
import { EnquirySourcesTable } from './EnquirySourcesTable'
import { FollowUpOptionsTable } from './FollowUpOptionsTable'
import { VendorsTable } from './VendorsTable'
import { VisaTypesTable } from './VisaTypesTable'

type ListTab =
  | 'countries'
  | 'visa-types'
  | 'embassies'
  | 'documents'
  | 'document-problem-reasons'
  | 'enquiry-sources'
  | 'follow-up-outcomes'
  | 'follow-up-next-steps'
  | 'enquiry-reasons'
  | 'vendors'

/** `visa`: read with Visa access, changed by the Visa HOD or the Head. `shared`: every department's, changed by any HOD. */
const TABS: { value: ListTab; label: string; visa: boolean; canEdit: (user: User) => boolean; editors: string }[] = [
  { value: 'countries', label: 'Countries', visa: true, canEdit: canEditVisaMasters, editors: 'the Head and the Visa HOD' },
  { value: 'visa-types', label: 'Visa types', visa: true, canEdit: canEditVisaMasters, editors: 'the Head and the Visa HOD' },
  { value: 'embassies', label: 'Embassies & visa centres', visa: false, canEdit: canEditEmbassies, editors: 'the Head and HODs' },
  { value: 'documents', label: 'Documents', visa: true, canEdit: canEditVisaMasters, editors: 'the Head and the Visa HOD' },
  {
    value: 'document-problem-reasons',
    label: 'Document problems',
    visa: true,
    canEdit: canEditVisaMasters,
    editors: 'the Head and the Visa HOD',
  },
  { value: 'enquiry-sources', label: 'Enquiry sources', visa: true, canEdit: canEditVisaMasters, editors: 'the Head and the Visa HOD' },
  { value: 'vendors', label: 'Vendors', visa: true, canEdit: canEditVisaMasters, editors: 'the Head and the Visa HOD' },
  { value: 'follow-up-outcomes', label: 'What happened', visa: false, canEdit: canEditEnquiryMasters, editors: 'the Head and HODs' },
  { value: 'follow-up-next-steps', label: 'Next steps', visa: false, canEdit: canEditEnquiryMasters, editors: 'the Head and HODs' },
  { value: 'enquiry-reasons', label: 'Postpone & cancel reasons', visa: false, canEdit: canEditEnquiryMasters, editors: 'the Head and HODs' },
]

/**
 * The small master lists, one tab each (?tab=…). Countries, visa types, documents, document problems, enquiry sources and
 * vendors are the Visa department's;
 * embassies and the follow-up and reason dropdowns are shared by every department (changed by any HOD).
 */
export function MasterListsPage() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const [showInactive, setShowInactive] = useState(false)
  if (!me) return null

  const visa = canViewVisaMasters(me)
  const tabs = TABS.filter((t) => visa || !t.visa)
  const current = tabs.find((t) => t.value === params.get('tab')) ?? tabs[0]!
  const tab = current.value
  const canEdit = current.canEdit(me)

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
            {!canEdit && ` You can look, but only ${current.editors} can change these.`}
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
      {tab === 'document-problem-reasons' && <DocumentProblemsTable canEdit={canEdit} showInactive={showInactive} />}
      {tab === 'enquiry-sources' && <EnquirySourcesTable canEdit={canEdit} showInactive={showInactive} />}
      {(tab === 'follow-up-outcomes' || tab === 'follow-up-next-steps') && (
        <FollowUpOptionsTable key={tab} resource={tab} canEdit={canEdit} showInactive={showInactive} />
      )}
      {tab === 'enquiry-reasons' && <EnquiryReasonsTable canEdit={canEdit} showInactive={showInactive} />}
      {tab === 'vendors' && <VendorsTable canEdit={canEdit} showInactive={showInactive} />}
    </>
  )
}
