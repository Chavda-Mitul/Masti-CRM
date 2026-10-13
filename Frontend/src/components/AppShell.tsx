import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { can, isHodOfAny } from '../auth/permissions'
import { roleSummary, useLogout, useMe } from '../auth/useAuth'
import { DEPARTMENT_STYLE, SELLING_DEPARTMENTS } from '../lib/departments'
import { initials } from '../lib/format'
import { useFollowUpBadge, useToAssignCount } from '../pages/enquiries/queries'
import { ErrorBoundary } from './ErrorBoundary'
import { NavIcon } from './NavIcon'

/** Sidebar layout from the approved demo. Modules not built yet are shown greyed out. */
export function AppShell() {
  const location = useLocation()
  const { data: user } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const badge = useFollowUpBadge()
  const assigns = !!user && isHodOfAny(user)
  const toAssign = useToAssignCount(assigns)

  if (!user) return null

  // With cases overdue, "Follow-ups" opens the Overdue tab in the badge's scope, so the number matches the screen.
  const overdue = badge.data?.overdue ?? 0
  const followUpsTo = overdue > 0 ? `/follow-ups?tab=overdue${badge.data?.scope === 'ALL' ? '&scope=all' : ''}` : '/follow-ups'

  // The department sub-items are the list filtered by ?department=; the New enquiry form and visa case pages count as Visa.
  const onEnquiries = location.pathname === '/enquiries' || location.pathname.startsWith('/enquiries/')
  const onVisaPage = location.pathname === '/enquiries/new' || location.pathname.toUpperCase().startsWith('/ENQUIRIES/VISA-')
  const search = new URLSearchParams(location.search)
  const department = onVisaPage ? 'VISA' : search.get('department')?.toUpperCase()
  // "To assign" is the list on its To assign tab; it, not "Enquiries", is highlighted then.
  const onToAssign = location.pathname === '/enquiries' && search.get('status')?.toLowerCase() === 'to_assign'
  const waiting = toAssign.data ?? 0

  const onLogout = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">Masti Travels</div>
            <div className="brand-sub">Tours &amp; Travels · Surat</div>
          </div>
        </div>

        <NavLink to="/" end className="nav">
          <NavIcon name="today" />
          Today
        </NavLink>

        <Link to="/enquiries" className={`nav${onEnquiries && !department && !onToAssign ? ' active' : ''}`}>
          <NavIcon name="enquiries" />
          Enquiries
        </Link>
        {SELLING_DEPARTMENTS.map((code) => {
          const style = DEPARTMENT_STYLE[code]!
          if (!can(user, code, 'VIEW')) {
            return (
              <span key={code} className="nav nav-sub nav-disabled">
                <span className="dot" style={{ background: style.solid }} />
                {style.label}
              </span>
            )
          }
          return (
            <Link
              key={code}
              to={`/enquiries?department=${code}`}
              className={`nav nav-sub${onEnquiries && department === code ? ' active' : ''}`}
            >
              <span className="dot" style={{ background: style.solid }} />
              {style.label}
            </Link>
          )
        })}

        <NavLink to={followUpsTo} className="nav">
          <NavIcon name="followUps" />
          Follow-ups
          {overdue > 0 && (
            <span className="nav-badge" title={`${overdue} overdue`} aria-label={`${overdue} overdue`}>
              {overdue > 99 ? '99+' : overdue}
            </span>
          )}
        </NavLink>
        {/* HODs and the Head only: matured cases waiting for a processor. Cases should never sit idle. */}
        {assigns && (
          <Link to="/enquiries?status=to_assign" className={`nav${onToAssign ? ' active' : ''}`}>
            <NavIcon name="toAssign" />
            To assign
            {waiting > 0 && (
              <span className="nav-badge" title={`${waiting} waiting for a processor`} aria-label={`${waiting} waiting for a processor`}>
                {waiting > 99 ? '99+' : waiting}
              </span>
            )}
          </Link>
        )}
        <NavLink to="/clients" className="nav">
          <NavIcon name="clients" />
          Clients
        </NavLink>
        <span className="nav nav-disabled">
          <NavIcon name="accounts" />
          Accounts <span className="tag">Soon</span>
        </span>

        <div className="sidebar-spacer" />

        {/* Field staff never reach the shell (RequireDesktop), so everyone here may open Settings → Masters. */}
        <NavLink to="/settings" className="nav">
          <NavIcon name="settings" />
          Settings
        </NavLink>

        <div className="user-card">
          <span className="avatar">{initials(user.name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="name">{user.name}</div>
            <div className="scope">{roleSummary(user)}</div>
          </div>
        </div>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onLogout} disabled={logout.isPending}>
          Log out
        </button>
      </aside>

      <main className="main">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
