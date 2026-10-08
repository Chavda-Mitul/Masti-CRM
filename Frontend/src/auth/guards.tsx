import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useMe } from './useAuth'

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>{children}</div>
}

/** Signed-in users only. Sends users with a temporary password to the change-password page first. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isPending, isError } = useMe()
  const location = useLocation()

  if (isPending) return <Centered><span className="muted">Loading…</span></Centered>
  if (isError) {
    return (
      <Centered>
        <div className="alert alert-bad">Can&apos;t reach the server. Check that the backend is running.</div>
      </Centered>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <>{children}</>
}

/** The desktop CRM: Head and office staff. Field staff are sent to their phone view. Use inside RequireAuth. */
export function RequireDesktop({ children }: { children: ReactNode }) {
  const { data: user } = useMe()
  if (user?.type === 'FIELD') return <Navigate to="/tasks" replace />
  return <>{children}</>
}

/** The field staff's phone view. Use inside RequireAuth. */
export function RequireField({ children }: { children: ReactNode }) {
  const { data: user } = useMe()
  if (user?.type !== 'FIELD') return <Navigate to="/" replace />
  return <>{children}</>
}

/** Head (owner) only. Use inside RequireAuth. */
export function RequireHead({ children }: { children: ReactNode }) {
  const { data: user } = useMe()
  if (user?.type !== 'HEAD') return <Navigate to="/" replace />
  return <>{children}</>
}
