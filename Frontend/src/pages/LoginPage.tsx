import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useLogin, useMe } from '../auth/useAuth'
import { ApiError } from '../lib/api'
import '../styles/auth.css'

export function LoginPage() {
  const { data: me } = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (me) return <Navigate to={me.mustChangePassword ? '/change-password' : from} replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate(
      { identifier, password },
      {
        onSuccess: ({ user }) => navigate(user.mustChangePassword ? '/change-password' : from, { replace: true }),
      },
    )
  }

  const error =
    login.error instanceof ApiError ? login.error.message : login.error ? "Can't reach the server. Please try again." : null

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">Masti Travels</div>
            <div className="brand-sub">Tours &amp; Travels · Surat</div>
          </div>
        </div>

        <div>
          <h1 className="h2" style={{ fontSize: 22 }}>
            Log in
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Use your mobile number or email.
          </p>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <label className="field">
            Mobile number or email
            <input
              className="input"
              autoComplete="username"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="98250 41234 or name@company.com"
              required
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <div className="alert alert-bad" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={login.isPending || !identifier || !password}>
            {login.isPending ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <div className="auth-foot">Forgot your password? Ask your admin to reset it.</div>
      </div>
    </div>
  )
}
