import { NavLink, Outlet, useNavigate } from 'react-router'
import { roleSummary, useLogout, useMe } from '../auth/useAuth'
import { DEPARTMENT_STYLE } from '../lib/departments'
import { initials } from '../lib/format'

const SELLING_DEPARTMENTS = ['VISA', 'HOLIDAYS', 'HOTELS', 'INSURANCE', 'TICKETS'] as const

/** Sidebar layout from the approved demo. Modules not built yet are shown greyed out. */
export function AppShell() {
  const { data: user } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  if (!user) return null

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

        <span className="nav nav-disabled">
          Enquiries <span className="tag">Soon</span>
        </span>
        {SELLING_DEPARTMENTS.map((code) => {
          const style = DEPARTMENT_STYLE[code]!
          return (
            <span key={code} className="nav nav-sub nav-disabled">
              <span className="dot" style={{ background: style.solid }} />
              {style.label}
            </span>
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

        {user.type === 'HEAD' && (
          <NavLink to="/settings/users" className="nav">
            Settings · Users
          </NavLink>
        )}

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
        <Outlet />
      </main>
    </div>
  )
}
