import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { Department, User, UserDepartment, UserType } from '../auth/types'
import { ME_KEY, useMe } from '../auth/useAuth'
import { api, ApiError } from '../lib/api'
import { departmentStyle } from '../lib/departments'
import { formatDateTime, formatMobile, initials } from '../lib/format'

type AccessChoice = '' | 'STAFF_VIEW' | 'STAFF_EDIT' | 'HOD'

const ACCESS_LABEL: Record<Exclude<AccessChoice, ''>, string> = {
  STAFF_VIEW: 'Staff · view only',
  STAFF_EDIT: 'Staff · can edit',
  HOD: 'HOD',
}

const TYPE_LABEL: Record<UserType, string> = {
  OFFICE: 'Office staff: works in the CRM, by department',
  FIELD: 'Field staff: collection & delivery, phone view only',
  HEAD: 'Head: full access to every department and to Settings',
}

function toChoice(d: UserDepartment | undefined): AccessChoice {
  if (!d) return ''
  if (d.role === 'HOD') return 'HOD'
  return d.access === 'EDIT' ? 'STAFF_EDIT' : 'STAFF_VIEW'
}

function fromChoice(departmentCode: string, choice: Exclude<AccessChoice, ''>) {
  return {
    departmentCode,
    role: choice === 'HOD' ? ('HOD' as const) : ('STAFF' as const),
    access: choice === 'STAFF_VIEW' ? ('VIEW' as const) : ('EDIT' as const),
  }
}

function errorText(err: unknown): string | null {
  if (!err) return null
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------------------

export function UsersPage() {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const users = useQuery({ queryKey: ['users'], queryFn: async () => (await api<{ users: User[] }>('/users')).users })
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api<{ departments: Department[] }>('/departments')).departments,
    staleTime: 5 * 60_000,
  })

  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const [confirming, setConfirming] = useState<{ kind: 'deactivate' | 'reset'; user: User } | null>(null)
  const [secret, setSecret] = useState<{ name: string; password: string; reason: 'created' | 'reset' } | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void queryClient.invalidateQueries({ queryKey: ME_KEY })
  }

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<{ user: User }>(`/users/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: () => {
      setConfirming(null)
      refresh()
    },
  })

  const resetPassword = useMutation({
    mutationFn: (id: string) => api<{ user: User; tempPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: ({ user, tempPassword }) => {
      setConfirming(null)
      setSecret({ name: user.name, password: tempPassword, reason: 'reset' })
      refresh()
    },
  })

  const list = users.data ?? []
  const activeCount = list.filter((u) => u.isActive).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Users</h1>
          <p>
            Who can log in, and what each person can see or change in each department. Deactivating someone ends their
            access immediately, on every device.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!departments.data}>
          + Add user
        </button>
      </div>

      <div className="card card-fill" style={{ overflow: 'hidden' }}>
        <div className="pad" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
          <h2 className="h2">Staff &amp; roles</h2>
          <span className="chip chip-muted">
            {activeCount} active{list.length > activeCount ? ` · ${list.length - activeCount} inactive` : ''}
          </span>
        </div>

        {users.isPending ? (
          <div className="pad muted card-fill-empty">Loading…</div>
        ) : users.isError ? (
          <div className="pad">
            <div className="alert alert-bad">{errorText(users.error)}</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile / email</th>
                <th>Departments</th>
                <th>Status</th>
                <th>Last login</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} style={u.isActive ? undefined : { opacity: 0.6 }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="avatar">{initials(u.name)}</span>
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {u.name} {u.id === me?.id && <span className="muted">(you)</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                          {u.type === 'HEAD' && <span className="chip chip-info">Head</span>}
                          {u.type === 'FIELD' && <span className="chip chip-muted">Field staff</span>}
                          {u.mustChangePassword && <span className="chip chip-warn">Temporary password</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 13 }}>
                      {formatMobile(u.mobile)}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {u.email}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {u.type === 'HEAD' && <span className="muted">All departments</span>}
                      {u.type === 'FIELD' && <span className="muted">Jobs assigned to them</span>}
                      {u.departments.map((d) => {
                        const s = departmentStyle(d.code)
                        return (
                          <span key={d.code} className="chip" style={{ background: s.tint, color: s.text }}>
                            {s.label} · {d.role === 'HOD' ? 'HOD' : d.access === 'EDIT' ? 'Edit' : 'View'}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td>
                    {u.isActive ? <span className="chip chip-ok">Active</span> : <span className="chip chip-muted">Inactive</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(u.lastLoginAt)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => setEditing(u)}>
                        Edit
                      </button>
                      {u.id !== me?.id && (
                        <>
                          <button className="btn btn-sm" onClick={() => setConfirming({ kind: 'reset', user: u })}>
                            Reset password
                          </button>
                          {u.isActive ? (
                            <button className="btn btn-sm btn-danger" onClick={() => setConfirming({ kind: 'deactivate', user: u })}>
                              Deactivate
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm"
                              onClick={() => setActive.mutate({ id: u.id, active: true })}
                              disabled={setActive.isPending}
                            >
                              Activate
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && departments.data && (
        <UserDrawer
          user={editing === 'new' ? null : editing}
          departments={departments.data}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null)
            refresh()
            if (result.tempPassword) setSecret({ name: result.user.name, password: result.tempPassword, reason: 'created' })
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.kind === 'deactivate' ? `Deactivate ${confirming.user.name}?` : `Reset ${confirming.user.name}'s password?`}
          body={
            confirming.kind === 'deactivate'
              ? 'They will be logged out everywhere straight away and won’t be able to log in. You can activate them again later.'
              : 'They will be logged out everywhere. You’ll get a temporary password to give them; they must change it when they log in.'
          }
          confirmLabel={confirming.kind === 'deactivate' ? 'Deactivate' : 'Reset password'}
          danger={confirming.kind === 'deactivate'}
          pending={setActive.isPending || resetPassword.isPending}
          error={errorText(setActive.error ?? resetPassword.error)}
          onCancel={() => {
            setConfirming(null)
            setActive.reset()
            resetPassword.reset()
          }}
          onConfirm={() =>
            confirming.kind === 'deactivate'
              ? setActive.mutate({ id: confirming.user.id, active: false })
              : resetPassword.mutate(confirming.user.id)
          }
        />
      )}

      {secret && <TempPasswordDialog {...secret} onClose={() => setSecret(null)} />}
    </>
  )
}

// ---------------------------------------------------------------------------

function UserDrawer({
  user,
  departments,
  onClose,
  onSaved,
}: {
  user: User | null
  departments: Department[]
  onClose: () => void
  onSaved: (result: { user: User; tempPassword?: string }) => void
}) {
  const { data: me } = useMe()
  const [name, setName] = useState(user?.name ?? '')
  const [mobile, setMobile] = useState(user?.mobile ? formatMobile(user.mobile) : '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [type, setType] = useState<UserType>(user?.type ?? 'OFFICE')
  const [access, setAccess] = useState<Record<string, AccessChoice>>(() =>
    Object.fromEntries(departments.map((d) => [d.code, toChoice(user?.departments.find((x) => x.code === d.code))])),
  )

  const save = useMutation({
    mutationFn: () => {
      // Only office staff have department access; the Head sees everything and field staff see their jobs.
      const memberships =
        type === 'OFFICE'
          ? departments.flatMap((d) => {
              const choice = access[d.code] ?? ''
              return choice ? [fromChoice(d.code, choice)] : []
            })
          : []
      const body = { name, mobile: mobile.trim() || null, email: email.trim() || null, type, departments: memberships }
      return user
        ? api<{ user: User }>(`/users/${user.id}`, { method: 'PATCH', body })
        : api<{ user: User; tempPassword?: string }>('/users', { method: 'POST', body })
    },
    onSuccess: onSaved,
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const editingSelf = user?.id === me?.id

  return (
    <div className="overlay" onClick={onClose}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <div className="pad" style={{ borderBottom: '1px solid var(--border-card)' }}>
          <h2 className="h2">{user ? `Edit ${user.name}` : 'Add a user'}</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
            {user
              ? 'Changes to access apply on their next click.'
              : 'They log in with their mobile number or email and a temporary password you’ll see after saving.'}
          </p>
        </div>

        <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          <label className="field">
            Full name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field">
              Mobile number
              <input className="input mono" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="98250 41234" />
            </label>
            <label className="field">
              Email
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </label>
          </div>
          <span className="hint">
            {type === 'FIELD'
              ? 'Field staff need a mobile number: their jobs and handover codes come on WhatsApp.'
              : 'A mobile number or an email is needed (or both). Either can be used to log in.'}
          </span>

          <label className="field" style={{ marginTop: 4 }}>
            Account type
            <select className="select" value={type} onChange={(e) => setType(e.target.value as UserType)} disabled={editingSelf}>
              {(['OFFICE', 'FIELD', 'HEAD'] as const).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          {type === 'OFFICE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              <span className="lbl">Department access</span>
              {departments.map((d) => {
                const s = departmentStyle(d.code)
                return (
                  <div key={d.code} style={{ display: 'grid', gridTemplateColumns: '1fr 190px', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700 }}>
                      <span className="dot" style={{ background: s.solid, width: 10, height: 10 }} />
                      {d.name}
                    </span>
                    <select
                      className="select"
                      value={access[d.code] ?? ''}
                      onChange={(e) => setAccess({ ...access, [d.code]: e.target.value as AccessChoice })}
                      aria-label={`${d.name} access`}
                    >
                      <option value="">No access</option>
                      {(Object.keys(ACCESS_LABEL) as Exclude<AccessChoice, ''>[]).map((k) => (
                        <option key={k} value={k}>
                          {ACCESS_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
              <span className="hint">HODs can always edit in their department, and get HOD-only powers like refund overrides.</span>
            </div>
          )}

          {save.error && (
            <div className="alert alert-bad" role="alert">
              {errorText(save.error)}
            </div>
          )}
        </div>

        <div className="pad" style={{ borderTop: '1px solid var(--border-card)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !name.trim()}>
            {save.isPending ? 'Saving…' : user ? 'Save changes' : 'Add user'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ConfirmDialog(props: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay overlay-center" onClick={props.onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2">{props.title}</h2>
        <p style={{ margin: 0 }}>{props.body}</p>
        {props.error && <div className="alert alert-bad">{props.error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button className={props.danger ? 'btn btn-dark' : 'btn btn-primary'} onClick={props.onConfirm} disabled={props.pending}>
            {props.pending ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function TempPasswordDialog({ name, password, reason, onClose }: { name: string; password: string; reason: 'created' | 'reset'; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(password).then(() => setCopied(true))
  }
  return (
    <div className="overlay overlay-center">
      <div className="dialog" role="dialog" aria-modal="true">
        <h2 className="h2">{reason === 'created' ? `${name} has been added` : `New password for ${name}`}</h2>
        <p style={{ margin: 0 }}>
          Give {name} this temporary password directly. It is shown <strong>only once</strong>; they&apos;ll choose their own when
          they log in.
        </p>
        <div
          className="mono"
          style={{
            fontSize: 22,
            textAlign: 'center',
            padding: '14px 10px',
            background: 'var(--fill-tile)',
            borderRadius: 12,
            letterSpacing: '0.04em',
          }}
        >
          {password}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
