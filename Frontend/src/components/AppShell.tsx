import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { can } from '../auth/permissions'
import { roleSummary, useLogout, useMe } from '../auth/useAuth'
import { DEPARTMENT_STYLE, SELLING_DEPARTMENTS } from '../lib/departments'
import { initials } from '../lib/format'
import { ErrorBoundary } from './ErrorBoundary'

/** Sidebar layout from the approved demo. Modules not built yet are shown greyed out. */
export function AppShell() {
  const location = useLocation()
  const { data: user } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  if (!user) return null

  // The department sub-items are the list filtered by ?department=; the New enquiry form counts as Visa (demo).
  const onEnquiries = location.pathname === '/enquiries' || location.pathname.startsWith('/enquiries/')
  const department = location.pathname === '/enquiries/new' ? 'VISA' : new URLSearchParams(location.search).get('department')?.toUpperCase()

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
          Today
        </NavLink>

        <Link to="/enquiries" className={`nav${onEnquiries && !department ? ' active' : ''}`}>
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

        <span className="nav nav-disabled">
          Follow-ups <span className="tag">Soon</span>
        </span>
        <NavLink to="/clients" className="nav">
          Clients
        </NavLink>
        <span className="nav nav-disabled">
          Accounts <span className="tag">Soon</span>
        </span>

        <div className="sidebar-spacer" />

        {/* Field staff never reach the shell (RequireDesktop), so everyone here may open Settings → Masters. */}
        <NavLink to="/settings" className="nav">
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
