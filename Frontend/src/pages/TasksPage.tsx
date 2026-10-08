import { Link, useNavigate } from 'react-router'
import { useLogout, useMe } from '../auth/useAuth'
import '../styles/auth.css'

/** Field staff's phone view. Placeholder until the field app (stops, handover proof) is built in the Visa stage. */
export function TasksPage() {
  const { data: user } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  const onLogout = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">Masti Travels</div>
            <div className="brand-sub">Collection &amp; delivery</div>
          </div>
        </div>

        <div>
          <h1 className="h2" style={{ fontSize: 22 }}>
            {user?.name.split(' ')[0]}&apos;s run
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Your pickups, deliveries and collections will show here, and on WhatsApp, once staff confirm them.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/change-password" className="btn" style={{ flex: 1 }}>
            Change password
          </Link>
          <button className="btn" style={{ flex: 1 }} onClick={onLogout} disabled={logout.isPending}>
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
