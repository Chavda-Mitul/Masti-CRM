import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useChangePassword, useLogout, useMe } from '../auth/useAuth'
import { ApiError } from '../lib/api'
import '../styles/auth.css'

const MIN_LENGTH = 8

export function ChangePasswordPage() {
  const { data: me } = useMe()
  const change = useChangePassword()
  const logout = useLogout()
  const navigate = useNavigate()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const forced = me?.mustChangePassword ?? false

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    if (newPassword.length < MIN_LENGTH) return setLocalError(`Use at least ${MIN_LENGTH} characters.`)
    if (newPassword !== confirm) return setLocalError('The two new passwords don’t match.')
    change.mutate({ currentPassword, newPassword }, { onSuccess: () => navigate('/', { replace: true }) })
  }

  const error = localError ?? (change.error instanceof ApiError ? change.error.message : null)

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div>
          <h1 className="h2" style={{ fontSize: 22 }}>
            {forced ? 'Set your own password' : 'Change password'}
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {forced
              ? 'You logged in with a temporary password. Choose your own to continue.'
              : 'Other devices will be logged out.'}
          </p>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <label className="field">
            {forced ? 'Temporary password' : 'Current password'}
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="field">
            New password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
            <span className="hint">At least {MIN_LENGTH} characters.</span>
          </label>
          <label className="field">
            New password again
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          {error && (
            <div className="alert alert-bad" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={change.isPending || !currentPassword || !newPassword}>
            {change.isPending ? 'Saving…' : 'Save password'}
          </button>
        </form>

        <div className="auth-foot">
          {forced ? (
            <button
              className="btn-link"
              onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}
            >
              Log out
            </button>
          ) : (
            <button className="btn-link" onClick={() => navigate(-1)}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
