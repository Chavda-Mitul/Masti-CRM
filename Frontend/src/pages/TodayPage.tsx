import { useState } from 'react'
import { Link } from 'react-router'
import { useMe } from '../auth/useAuth'

function greetingNow() {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

/** Placeholder until the Today dashboard is built (Stage 1). */
export function TodayPage() {
  const { data: user } = useMe()
  const [greeting] = useState(greetingNow)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">
            {greeting}, {user?.name.split(' ')[0]}
          </h1>
          <p>The Today dashboard arrives with the Visa stage. Login, roles and user management are ready.</p>
        </div>
      </div>
      <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
        <span className="lbl">Your access</span>
        {user?.type === 'HEAD' ? (
          <span>
            You are <strong>Head</strong>: you can see every department and manage users in{' '}
            <Link to="/settings/users">Settings · Users</Link>.
          </span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {user?.departments.map((d) => (
              <li key={d.code}>
                {d.name}: {d.role === 'HOD' ? 'HOD' : d.access === 'EDIT' ? 'Staff (can edit)' : 'Staff (view only)'}
              </li>
            ))}
          </ul>
        )}
        <Link to="/change-password">Change my password</Link>
      </div>
    </>
  )
}
