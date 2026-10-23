import type { Outcome } from '../../../lib/portalHelper'
import type { PasswordSchedule } from './schemas'

// Mirrors Backend/src/modules/portalLogins (portalLogin.ts toPortalLoginDto, portalLogins.service.ts listPortalLogins).

export interface PortalPerson {
  id: string
  name: string
}

/** A portal as the API sends it. Never its ID or password; the address only to the people who manage it. */
export interface Portal {
  id: string
  department: { code: string; name: string }
  name: string
  /** What the portal calls the first box: "ID", "Agency code". */
  idLabel: string
  /** A third login box's name ("Agency code"), or null for an ordinary two-box login; its value is never sent. */
  extraLabel: string | null
  /** What to do on the portal once it's open; the helper shows it there. */
  steps: string[]
  status: 'ACTIVE' | 'REMOVED'
  users: PortalPerson[]
  passwordChangedAt: string
  /** How often the password has to change (component 2). */
  passwordSchedule: PasswordSchedule
  /** The day it has to change by (YYYY-MM-DD), or null with no schedule. */
  passwordDueOn: string | null
  /** Overdue: nobody can use it until an HOD types a new password. canUse still says who could. */
  locked: boolean
  createdAt: string
  updatedAt: string
  canUse: boolean
  canEdit: boolean
  loginUrl?: string
  secureAddress?: boolean
}

/** One press the helper collected, for "Who used what". */
export interface PortalUse {
  id: string
  user: PortalPerson
  portal: { id: string; name: string }
  /** The visa case it was pressed on (component 3); null from Settings → Portal logins. */
  caseNo: string | null
  at: string
  outcome: Outcome | null
}

export interface PortalLoginsData {
  portals: Portal[]
  uses: PortalUse[]
  /** The departments this person may add portals to. */
  addTo: { code: string; name: string }[]
  /** Masti's office addresses are set: Log in for me works only from them. */
  officeAddressesSet: boolean
  /** The server can save and use portal logins (PORTAL_VAULT_KEY is set). */
  ready: boolean
  /** The CRM helper's extension IDs. */
  helperIds: string[]
}

/** Someone who may go on a portal's list. */
export interface Person {
  id: string
  name: string
  role: 'STAFF' | 'HOD'
}

export interface PortalBody {
  departmentCode?: string
  name?: string
  loginUrl?: string
  idLabel?: string
  loginId?: string
  password?: string
  /** A third login box's name; "" removes it. */
  extraLabel?: string
  /** That box's value. */
  extra?: string
  /** The to-dos shown when the portal opens. */
  steps?: string[]
  passwordSchedule?: PasswordSchedule
  userIds?: string[]
  updatedAt?: string
}
