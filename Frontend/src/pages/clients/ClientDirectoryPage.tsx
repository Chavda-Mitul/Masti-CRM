import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { canEditClients } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { formatMobile, initials } from '../../lib/format'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import '../../styles/clients.css'
import { errorText } from './apiErrors'
import { ReadinessBadge } from './ClientBadges'
import { ClientFormDrawer } from './ClientFormDrawer'
import { useClientList, useClientOptions } from './queries'
import type { ClientListFilters } from './types'

const KINDS: Record<string, ClientListFilters['kind']> = { INDIVIDUAL: 'INDIVIDUAL', CORPORATE: 'CORPORATE' }
const READINESS: Record<string, ClientListFilters['incomplete']> = { true: 'true', false: 'false' }

/** Search and filters live in the URL (?q=&kind=&incomplete=), so Back from a client returns to the same list. */
export function ClientDirectoryPage() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [adding, setAdding] = useState(false)
  const q = useDebouncedValue(search.trim(), 300)

  const filters: ClientListFilters = {
    q,
    kind: KINDS[params.get('kind') ?? ''] ?? '',
    incomplete: READINESS[params.get('incomplete') ?? ''] ?? '',
  }
  const list = useClientList(filters)
  const options = useClientOptions()
  const canEdit = me ? canEditClients(me) : false

  // Mirror the debounced search into the URL.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (q) next.set('q', q)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [q, setParams])

  const setFilter = (key: 'kind' | 'incomplete', value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  const rows = list.data?.pages.flatMap((p) => p.clients) ?? []
  const filtering = Boolean(filters.q || filters.kind || filters.incomplete)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Clients</h1>
          <p>Every client and family, across all departments. A client is found by any of their numbers.</p>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!options.data}>
            + Add client
          </button>
        )}
      </div>

      <div className="card card-fill" style={{ overflow: 'hidden' }}>
        <div className="pad toolbar">
          <input
            className="input search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, mobile, PAN, GSTIN or passport number"
            aria-label="Search clients"
            autoFocus
          />
          <select
            className="select"
            value={filters.kind}
            onChange={(e) => setFilter('kind', e.target.value)}
            aria-label="Kind of client"
          >
            <option value="">People &amp; companies</option>
            <option value="INDIVIDUAL">People / families</option>
            <option value="CORPORATE">Companies</option>
          </select>
          <select
            className="select"
            value={filters.incomplete}
            onChange={(e) => setFilter('incomplete', e.target.value)}
            aria-label="Details"
          >
            <option value="">Any details</option>
            <option value="true">Details missing for invoicing</option>
            <option value="false">Ready to invoice</option>
          </select>
        </div>

        {list.isPending ? (
          <div className="pad muted card-fill-empty">Loading…</div>
        ) : list.isError ? (
          <div className="pad">
            <div className="alert alert-bad">{errorText(list.error)}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad muted card-fill-empty">
            {filtering ? 'No clients match. Try part of the mobile number, or fewer filters.' : 'No clients yet.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Mobile</th>
                <th>Area</th>
                <th>Accounts code</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="row-link" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <div className="client-cell">
                      <span className="avatar">{c.name ? initials(c.name) : '?'}</span>
                      <div>
                        <Link to={`/clients/${c.id}`} className="client-name" onClick={(e) => e.stopPropagation()}>
                          {c.name ?? 'Name not given yet'}
                        </Link>
                        <div className="muted small">
                          {c.kind === 'CORPORATE' ? `Company${c.contactPerson ? ` · ${c.contactPerson}` : ''}` : 'Person / family'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{formatMobile(c.mobile)}</td>
                  <td>{[c.area, c.city].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                  <td className="mono">{c.accountingCode ?? <span className="muted">—</span>}</td>
                  <td>
                    <ReadinessBadge readiness={c.readiness} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {list.hasNextPage && (
          <div className="pad" style={{ textAlign: 'center' }}>
            <button className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          </div>
        )}
      </div>

      {adding && options.data && (
        <ClientFormDrawer
          client={null}
          options={options.data}
          onClose={() => setAdding(false)}
          onSaved={(client) => navigate(`/clients/${client.id}`)}
        />
      )}
    </>
  )
}
