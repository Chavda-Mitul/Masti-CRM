import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { can, canEditClients } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { ApiError } from '../../lib/api'
import { departmentStyle } from '../../lib/departments'
import { formatDate, formatMobile, initials } from '../../lib/format'
import '../../styles/clients.css'
import { errorText } from './apiErrors'
import { ReadinessBadge } from './ClientBadges'
import { ClientFormDrawer } from './ClientFormDrawer'
import { MembersCard } from './MembersCard'
import { NotesCard } from './NotesCard'
import { PhonesCard } from './PhonesCard'
import { useClient, useClientOptions } from './queries'
import type { ClientOptions, ClientProfile } from './types'

/** The client profile (demo screen 23). Cases, money and messages join it as those modules are built. */
export function ClientDetailPage() {
  const { id = '' } = useParams()
  const { data: me } = useMe()
  const client = useClient(id)
  const options = useClientOptions()
  const [editing, setEditing] = useState(false)
  const canEdit = me ? canEditClients(me) : false
  // Only Visa intake is built so far; other departments' intakes come in Stage 2.
  const canAddEnquiry = me ? can(me, 'VISA', 'EDIT') : false

  if (client.isPending) return <div className="muted">Loading…</div>
  if (client.isError) {
    const missing = client.error instanceof ApiError && client.error.status === 404
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <h1 className="h2">{missing ? 'Client not found' : 'Couldn’t load this client'}</h1>
        {!missing && <div className="alert alert-bad">{errorText(client.error)}</div>}
        <p className="muted">
          <Link to="/clients">Back to all clients</Link>
        </p>
      </div>
    )
  }

  const c = client.data
  const name = c.name
  const place = [c.area, c.city].filter(Boolean).join(', ')

  return (
    <>
      <Link to="/clients" className="back-link">
        ← All clients
      </Link>

      <div className="card pad client-head">
        <span className="avatar avatar-lg">{c.name ? initials(c.name) : '?'}</span>
        <div className="client-head-text">
          <div className="client-title">
            <h1 className="h1">{name}</h1>
            {c.kind === 'CORPORATE' && <span className="chip chip-muted">Company</span>}
            <ReadinessBadge readiness={c.readiness} />
          </div>
          <div className="muted client-meta">
            <span className="mono">{formatMobile(c.mobile)}</span>
            {c.email && <span>{c.email}</span>}
            {place && <span>{place}</span>}
            <span>client since {c.clientSince.slice(0, 4)}</span>
            <span>customer code in accounts: {c.accountingCode ?? 'not set'}</span>
          </div>
        </div>
        <div className="client-head-actions">
          {canEdit && (
            <button className="btn" onClick={() => setEditing(true)} disabled={!options.data}>
              Edit details
            </button>
          )}
          {canAddEnquiry && (
            <Link className="btn btn-primary" to={`/enquiries/new?mobile=${encodeURIComponent(c.mobile)}`}>
              New enquiry for {c.name?.split(' ')[0] ?? 'this client'}
            </Link>
          )}
        </div>
      </div>

      <div className="tiles">
        <Tile label="Business with us" value="—" note="Comes with Accounts" />
        <Tile label="Open now" value={String(c.openEnquiries.length)} note={openDepartments(c) || 'No open cases'} />
        <Tile label="Still to pay" value="—" note="Comes with Accounts" />
        <Tile
          label="Pays"
          value={c.paymentHabit?.name ?? 'Not set'}
          note={c.billingCycle ? `Billing cycle: ${c.billingCycle.name.toLowerCase()}` : undefined}
        />
      </div>

      <div className="client-grid">
        <div className="client-col">
          <MembersCard client={c} options={options.data} canEdit={canEdit} />
          <DetailsCard client={c} options={options.data} canEdit={canEdit} onEdit={() => setEditing(true)} />
          <CasesCard client={c} />
        </div>
        <div className="client-col">
          <PhonesCard client={c} canEdit={canEdit} />
          <NotesCard clientId={c.id} latest={c.notes} canEdit={canEdit} />
        </div>
      </div>

      {editing && options.data && (
        <ClientFormDrawer client={c} options={options.data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
    </>
  )
}

/** "Visa, Holidays": the departments with an open case. */
function openDepartments(client: ClientProfile) {
  return [...new Set(client.openEnquiries.map((e) => departmentStyle(e.department).label))].join(', ')
}

/** Open cases for now. Finished cases join the list once a case can be finished (the case steps come next). */
function CasesCard({ client }: { client: ClientProfile }) {
  return (
    <div className="card pad">
      <h2 className="h2">Everything we&apos;ve done for this family</h2>
      {client.openEnquiries.length === 0 ? (
        <p className="muted" style={{ margin: '8px 0 0' }}>
          No open cases.
        </p>
      ) : (
        <ul className="case-list">
          {client.openEnquiries.map((e) => {
            const style = departmentStyle(e.department)
            return (
              <li key={e.caseNo}>
                <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
                  {style.label}
                </span>
                <div className="case-list-main">
                  <Link to={`/enquiries?q=${encodeURIComponent(e.caseNo)}`} className="mono">
                    {e.caseNo}
                  </Link>
                  <div className="muted small">{e.summary}</div>
                </div>
                <span className="small">{e.stage}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <span className="tile-note">{note}</span>}
    </div>
  )
}

function DetailsCard({
  client,
  options,
  canEdit,
  onEdit,
}: {
  client: ClientProfile
  options: ClientOptions | undefined
  canEdit: boolean
  onEdit: () => void
}) {
  const state = options?.states.find((s) => s.code === client.stateCode)?.name ?? client.stateCode
  const address = [client.addressLine, client.area, client.city, state, client.pincode].filter(Boolean).join(', ')
  const rows: { label: string; value: string | null | undefined; mono?: boolean }[] = [
    ...(client.kind === 'CORPORATE' ? [{ label: 'Contact person', value: client.contactPerson }] : []),
    { label: 'Email', value: client.email },
    { label: 'Address', value: address || null },
    { label: 'PAN', value: client.pan, mono: true },
    { label: 'GSTIN', value: client.gstin, mono: true },
    { label: 'Accounts code', value: client.accountingCode, mono: true },
    { label: 'Billing cycle', value: client.billingCycle?.name },
    { label: 'Pays', value: client.paymentHabit?.name },
    { label: 'Client since', value: formatDate(client.clientSince) },
  ]

  return (
    <div className="card">
      <div className="pad card-head">
        <h2 className="h2">Details</h2>
        {canEdit && (
          <button className="btn btn-sm" onClick={onEdit} disabled={!options}>
            Edit
          </button>
        )}
      </div>
      {!client.readiness.ready && (
        <div className="pad" style={{ paddingTop: 0 }}>
          <div className="alert alert-warn">
            Before an invoice can be raised, add: {client.readiness.missing.map((m) => m.label).join(', ')}.
          </div>
        </div>
      )}
      <dl className="details">
        {rows.map(({ label, value, mono }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={mono ? 'mono' : undefined}>{value || <span className="muted">Not given</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
