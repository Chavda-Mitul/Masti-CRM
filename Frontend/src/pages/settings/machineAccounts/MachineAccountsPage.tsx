import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { FormField } from '../../../components/FormField'
import { SecretOnceDialog } from '../../../components/SecretOnceDialog'
import { api } from '../../../lib/api'
import { applyServerIssues, errorText } from '../../../lib/apiErrors'
import { formatDateTime } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { apiClientBody, apiClientFormSchema, type ApiClientBody, type ApiClientFormValues, type ApiScope } from './schemas'

// Machine accounts (docs/decisions/0005-system-masters.md §5): programs that call the CRM with an API key instead of a
// login, e.g. the holiday bot. Head only (the route guard and the API both check). The key is shown once.

interface ApiClient {
  id: string
  name: string
  keyPrefix: string
  scopes: ApiScope[]
  allowedIps: string[]
  isActive: boolean
  lastUsedAt: string | null
  lastUsedIp: string | null
  createdAt: string
  createdBy: { id: string; name: string }
}

const SCOPES: { value: ApiScope; label: string; hint: string }[] = [
  { value: 'HOLIDAYS_PUSH', label: 'Send embassy holidays', hint: 'They arrive as “Waiting for review” in the holiday calendar.' },
]
const SCOPE_LABEL = Object.fromEntries(SCOPES.map((s) => [s.value, s.label])) as Record<ApiScope, string>

const KEY = ['api-clients'] as const

export function MachineAccountsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const clients = useQuery({ queryKey: KEY, queryFn: async () => (await api<{ clients: ApiClient[] }>('/api-clients')).clients })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY })

  const [editing, setEditing] = useState<ApiClient | 'new' | null>(null)
  const [rotating, setRotating] = useState<ApiClient | null>(null)
  const [secret, setSecret] = useState<{ name: string; key: string; reason: 'created' | 'rotated' } | null>(null)

  const rotate = useMutation({
    mutationFn: (id: string) => api<{ client: ApiClient; key: string }>(`/api-clients/${id}/rotate`, { method: 'POST' }),
    onSuccess: ({ client, key }) => {
      setRotating(null)
      setSecret({ name: client.name, key, reason: 'rotated' })
      refresh()
    },
  })
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<{ client: ApiClient }>(`/api-clients/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: ({ client }) => {
      toast({ tone: 'ok', message: client.isActive ? `${client.name} can call the CRM again.` : `${client.name} is switched off. Its key stops working now.` })
      refresh()
    },
    onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not change it.' }),
  })

  const list = clients.data ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Machine accounts</h1>
          <p>
            Programs that send data to the CRM on their own, such as the holiday bot. Each has its own key, shown only once. Switching
            one off, or making a new key, stops the old key straight away.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add a machine account
        </button>
      </div>

      <section className="card card-fill" style={{ overflow: 'hidden' }}>
        {clients.isPending ? (
          <div className="pad muted card-fill-empty">Loading…</div>
        ) : clients.isError ? (
          <div className="pad">
            <div className="alert alert-bad">{errorText(clients.error)}</div>
          </div>
        ) : list.length === 0 ? (
          <div className="pad muted card-fill-empty">No machine accounts yet. Add one when the holiday bot is ready.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Can</th>
                <th>Allowed from</th>
                <th>Last used</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.isActive ? undefined : 'row-off'}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                    <div className="hint">Added by {c.createdBy.name}</div>
                  </td>
                  <td className="mono small">{c.keyPrefix}</td>
                  <td>
                    <div className="chip-row">
                      {c.scopes.map((s) => (
                        <span key={s} className="chip chip-info chip-sm">
                          {SCOPE_LABEL[s] ?? s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="small">{c.allowedIps.length ? <span className="mono">{c.allowedIps.join(', ')}</span> : <span className="muted">Any address</span>}</td>
                  <td className="small">
                    {c.lastUsedAt ? (
                      <>
                        {formatDateTime(c.lastUsedAt)}
                        {c.lastUsedIp && <div className="hint mono">{c.lastUsedIp}</div>}
                      </>
                    ) : (
                      <span className="muted">Never</span>
                    )}
                  </td>
                  <td>{c.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(c)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRotating(c)}>
                        New key
                      </button>
                      <button
                        type="button"
                        className={c.isActive ? 'btn btn-sm btn-danger' : 'btn btn-sm'}
                        onClick={() => setActive.mutate({ id: c.id, active: !c.isActive })}
                        disabled={setActive.isPending}
                      >
                        {c.isActive ? 'Switch off' : 'Switch on'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <ApiClientDrawer
          client={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null)
            refresh()
            if (result.key) setSecret({ name: result.client.name, key: result.key, reason: 'created' })
            else toast({ tone: 'ok', message: `${result.client.name} saved.` })
          }}
        />
      )}

      {rotating && (
        <ConfirmDialog
          title={`New key for ${rotating.name}?`}
          body="The current key stops working straight away. Put the new key into the program before it next sends anything."
          confirmLabel="Make a new key"
          danger
          pending={rotate.isPending}
          error={errorText(rotate.error)}
          onCancel={() => {
            setRotating(null)
            rotate.reset()
          }}
          onConfirm={() => rotate.mutate(rotating.id)}
        />
      )}

      {secret && (
        <SecretOnceDialog
          title={secret.reason === 'created' ? `${secret.name} is ready` : `New key for ${secret.name}`}
          secret={secret.key}
          onClose={() => setSecret(null)}
        >
          Put this key into the program’s settings. It is shown <strong>only once</strong>: the CRM keeps only a fingerprint of it. If
          it’s lost, make a new key.
        </SecretOnceDialog>
      )}
    </>
  )
}

/**
 * Add a machine account (the key comes back once) or change its name, permissions and allowed addresses.
 * Editing sends only the fields that changed, and closes without a request when nothing did.
 */
function ApiClientDrawer({
  client,
  onClose,
  onSaved,
}: {
  client: ApiClient | null
  onClose: () => void
  onSaved: (result: { client: ApiClient; key?: string }) => void
}) {
  const { register, handleSubmit, control, setError, formState } = useForm<ApiClientFormValues>({
    resolver: zodResolver(apiClientFormSchema),
    defaultValues: { name: client?.name ?? '', scopes: client?.scopes ?? ['HOLIDAYS_PUSH'], allowedIps: (client?.allowedIps ?? []).join('\n') },
  })
  const { errors } = formState

  const save = useMutation({
    mutationFn: (body: ApiClientBody) =>
      client
        ? api<{ client: ApiClient }>(`/api-clients/${client.id}`, { method: 'PATCH', body })
        : api<{ client: ApiClient; key: string }>('/api-clients', { method: 'POST', body }),
    onSuccess: onSaved,
    onError: (err) => applyServerIssues(err, setError, ['name', 'scopes', 'allowedIps']),
  })

  const onSubmit = handleSubmit((values) => {
    const body = apiClientBody(values, client ? (field) => Boolean(formState.dirtyFields[field]) : () => true)
    if (client && Object.keys(body).length === 0) return onClose()
    save.mutate(body)
  })

  return (
    <div className="overlay" onClick={onClose}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} noValidate>
        <div className="pad drawer-head">
          <h2 className="h2">{client ? `Edit ${client.name}` : 'Add a machine account'}</h2>
          <p className="muted">{client ? 'The key stays the same.' : 'You’ll see its key once, after saving.'}</p>
        </div>
        <div className="pad drawer-body">
          <FormField label="Name" error={errors.name?.message}>
            <input className="input" {...register('name')} placeholder="Holiday bot" autoFocus />
          </FormField>

          <span className="lbl section-lbl">It can</span>
          <Controller
            control={control}
            name="scopes"
            render={({ field }) => (
              <>
                {SCOPES.map((s) => (
                  <label key={s.value} className="check">
                    <input
                      type="checkbox"
                      checked={field.value.includes(s.value)}
                      onChange={(e) => field.onChange(e.target.checked ? [...field.value, s.value] : field.value.filter((x) => x !== s.value))}
                      onBlur={field.onBlur}
                    />
                    <span>
                      {s.label}
                      <span className="hint" style={{ display: 'block' }}>
                        {s.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </>
            )}
          />
          {errors.scopes?.message && (
            <span className="field-error" role="alert">
              {errors.scopes.message}
            </span>
          )}

          <FormField
            label="Allowed from (optional)"
            error={errors.allowedIps?.message}
            hint="One IP address or range per line, e.g. 203.0.113.10 or 203.0.113.0/24. Empty: any address."
          >
            <textarea className="input textarea mono" {...register('allowedIps')} rows={3} placeholder="203.0.113.10" />
          </FormField>

          {errorText(save.error) && (
            <div className="alert alert-bad" role="alert">
              {errorText(save.error)}
            </div>
          )}
        </div>
        <div className="pad drawer-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : client ? 'Save changes' : 'Add and show key'}
          </button>
        </div>
      </form>
    </div>
  )
}
