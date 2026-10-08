import { useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PassportValidity } from './ClientBadges'
import { errorText } from './apiErrors'
import { MemberFormDrawer } from './MemberFormDrawer'
import { useArchiveMember } from './queries'
import type { ClientMember, ClientOptions, ClientProfile } from './types'

/** "Family & travellers" from the demo (a company's employees for corporate clients). */
export function MembersCard({ client, options, canEdit }: { client: ClientProfile; options: ClientOptions | undefined; canEdit: boolean }) {
  const [editing, setEditing] = useState<ClientMember | 'new' | null>(null)
  const [archiving, setArchiving] = useState<ClientMember | null>(null)
  const archive = useArchiveMember(client.id)
  const title = client.kind === 'CORPORATE' ? 'Employees & travellers' : 'Family & travellers'

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="pad card-head">
        <h2 className="h2">{title}</h2>
        {canEdit && (
          <button className="btn btn-sm" onClick={() => setEditing('new')} disabled={!options}>
            + Add person
          </button>
        )}
      </div>

      {client.members.length === 0 ? (
        <div className="pad muted" style={{ paddingTop: 0 }}>
          No one added yet. Add the people who travel, with their passport details.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Relation</th>
              <th>Passport</th>
              <th>Passport valid till</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {client.members.map((m) => (
              <tr key={m.id}>
                <td style={{ fontWeight: 700 }}>{m.name}</td>
                <td>
                  {m.relation?.name ?? '—'}
                  {m.age !== null && `, ${m.age}`}
                </td>
                <td className="mono">{m.passportNumber ?? <span className="muted">—</span>}</td>
                <td>
                  <PassportValidity expiry={m.passportExpiry} status={m.passportStatus} />
                </td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => setEditing(m)} disabled={!options}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => setArchiving(m)}>
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && options && (
        <MemberFormDrawer
          clientId={client.id}
          member={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      )}

      {archiving && (
        <ConfirmDialog
          title={`Take ${archiving.name} off the list?`}
          body="They won't be offered for new cases. Nothing is deleted: past cases and the history keep their details."
          confirmLabel="Take off the list"
          danger
          pending={archive.isPending}
          error={errorText(archive.error)}
          onCancel={() => {
            setArchiving(null)
            archive.reset()
          }}
          onConfirm={() => archive.mutate(archiving.id, { onSuccess: () => setArchiving(null) })}
        />
      )}
    </div>
  )
}
