import { useState } from 'react'
import { Link } from 'react-router'
import { can, canEditVisaMasters, isHodOf } from '../../../auth/permissions'
import type { User } from '../../../auth/types'
import { api } from '../../../lib/api'
import { useToast } from '../../../lib/toast'
import type { PressResult } from '../../settings/portals/labels'
import { LogInForMeButton, type OpenedPress } from '../../settings/portals/LogInForMeButton'
import type { CasePortal, VisaCase } from '../types'

/** Who may press it on a case: a copy of the backend's canUsePortalOnCase (Backend/src/modules/portalLogins/portalLogin.ts). */
function canUseOnCase(me: User, c: VisaCase, portal: CasePortal): boolean {
  if (!me.isActive || me.mustChangePassword) return false
  if (me.type !== 'HEAD' && me.type !== 'OFFICE') return false
  if (isHodOf(me, 'VISA')) return true
  if (portal.userIds.includes(me.id) && can(me, 'VISA', 'VIEW')) return true
  return me.type === 'OFFICE' && c.owner?.id === me.id && can(me, c.department.code, 'EDIT')
}

/**
 * The demo's dark box (screen 08; docs/decisions/0024-portal-logins.md component 3): the portal the case's visa opens,
 * with Log in for me, from step 3 until the case closes. With no portal saved for the visa, a note says so; the Head and
 * the Visa HOD get a link to the visa's settings page. While the portal's password change is overdue, the box says it's
 * locked and the button is greyed out (component 2); they get a link to Portal logins.
 */
export function CasePortalBox({ visaCase: c, me }: { visaCase: VisaCase; me: User }) {
  const toast = useToast()
  /** What the last press said, kept while something needs doing. */
  const [result, setResult] = useState<PressResult | null>(null)
  if (c.status !== 'OPEN') return null

  const portal = c.portal
  if (!portal) {
    return (
      <p className="muted small application-portal-note">
        {canEditVisaMasters(me) ? (
          <>
            No portal saved for this visa. <Link to={`/settings/masters/checklists/${c.offeringId}`}>Add it in Settings</Link>
          </>
        ) : (
          'No portal saved for this visa. Ask your HOD to add it.'
        )}
      </p>
    )
  }

  const onResult = (next: PressResult) => {
    toast({ tone: next.tone, message: next.message })
    setResult(next.keep ? next : null)
  }

  return (
    <>
      <div className="application-portal">
        <div className="application-portal-text">
          <strong>{portal.name} — Masti master account</strong>
          {portal.locked ? (
            <span className="application-portal-locked">
              Locked until the HOD changes its password.
              {canEditVisaMasters(me) && (
                <>
                  {' '}
                  <Link to="/settings/portals">Change it on Portal logins</Link>
                </>
              )}
            </span>
          ) : (
            <span>Opens logged in for this case. Staff never see the ID or password.</span>
          )}
        </div>
        {canUseOnCase(me, c, portal) && (
          <LogInForMeButton
            portal={portal}
            helperIds={portal.helperIds}
            caseNo={c.caseNo}
            className="btn btn-primary"
            disabled={portal.locked}
            open={() => api<OpenedPress>(`/visa/cases/${encodeURIComponent(c.caseNo)}/portal/open`, { method: 'POST', body: {} })}
            onResult={onResult}
          />
        )}
      </div>
      {result && (
        <div className={`alert alert-${result.tone}`} role="status">
          {result.message}
        </div>
      )}
    </>
  )
}
