import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError } from '../../../lib/api'
import { errorText } from '../../../lib/apiErrors'
import { departmentStyle } from '../../../lib/departments'
import '../../../styles/case.css'
import { useVisaCase } from '../queries'
import { ApplicationCard } from './ApplicationCard'
import { ArrivalCard } from './ArrivalCard'
import { CaseHeader } from './CaseHeader'
import { CaseRail } from './CaseRail'
import { ChecklistCard } from './ChecklistCard'
import { ConsentCard } from './ConsentCard'
import { DispatchCard } from './DispatchCard'
import { DocketCard } from './DocketCard'
import { FollowUpsCard } from './FollowUpsCard'
import { MaturedBanner } from './MaturedBanner'
import { SavedFileCard } from './SavedFileCard'
import { StickerCard } from './StickerCard'
import { TripCard } from './TripCard'

/**
 * One visa case (demo screen 07): the header with its steps, then the Step 2 cards (checklist, how documents arrive,
 * follow-ups, consent) and the right rail. Read-only for now; the actions come card by card (0006).
 * Staff open only their own cases, the HOD the department's, the Head all: the API says 403 otherwise.
 */
export function VisaCasePage() {
  const { caseNo = '' } = useParams()
  const visaCase = useVisaCase(caseNo)

  if (visaCase.isPending) return <div className="muted">Loading…</div>
  if (visaCase.isError) {
    const status = visaCase.error instanceof ApiError ? visaCase.error.status : 0
    const title = status === 404 ? 'Case not found' : status === 403 ? 'This case is someone else’s' : 'Couldn’t load this case'
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <h1 className="h2">{title}</h1>
        {status === 403 && (
          <p className="muted">Only the person it is assigned to, the department’s HOD and the Head can open it.</p>
        )}
        {status !== 403 && status !== 404 && <div className="alert alert-bad">{errorText(visaCase.error)}</div>}
        <p className="muted">
          <Link to="/enquiries?department=VISA">Back to Visa enquiries</Link>
        </p>
      </div>
    )
  }

  const c = visaCase.data
  const style = departmentStyle(c.department.code)
  const colours = { '--dept': style.solid, '--dept-tint': style.tint, '--dept-text': style.text } as CSSProperties

  return (
    <div className="case-page" style={colours}>
      <Link to={`/enquiries?department=${c.department.code}`} className="back-link">
        ‹ {style.label} enquiries
      </Link>
      <CaseHeader visaCase={c} />
      <div className="case-grid">
        <div className="case-col">
          <DocketCard visaCase={c} />
          {c.docket && (
            <div className="case-pair dispatch-pair">
              <DispatchCard visaCase={c} />
              <StickerCard visaCase={c} />
            </div>
          )}
          <MaturedBanner visaCase={c} />
          <ChecklistCard visaCase={c} />
          <TripCard visaCase={c} />
          <ApplicationCard visaCase={c} />
          <SavedFileCard visaCase={c} />
          <div className="case-pair">
            <ArrivalCard visaCase={c} />
            <FollowUpsCard visaCase={c} />
          </div>
          <ConsentCard visaCase={c} />
        </div>
        <CaseRail visaCase={c} />
      </div>
    </div>
  )
}
