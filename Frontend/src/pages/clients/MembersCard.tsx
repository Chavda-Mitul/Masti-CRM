import { useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { istToday } from '../../lib/format'
import { dayMonth } from '../enquiries/case/labels'
import { PassportValidity } from './ClientBadges'
import { errorText } from './apiErrors'
import { MemberFormDrawer } from './MemberFormDrawer'
import { useArchiveMember, useMarkPaperConsent, useRemovePaperConsent } from './queries'
import type { ClientMember, ClientOptions, ClientProfile } from './types'

/** The oldest year a paper consent can be marked from (the database allows 1990 on). */
const FIRST_PAPER_YEAR = 1990

/**
 * "Family & travellers" from the demo (a company's employees for corporate clients), with each person's consent form
 * (docs/decisions/0022-consent-form.md, part 3). The Head or the Visa HOD (canMarkConsent) marks a consent signed on
 * paper before the CRM, or takes a mistaken mark off.
 */
export function MembersCard({
  client,
  options,
  canEdit,
  canMarkConsent,
}: {
  client: ClientProfile
  options: ClientOptions | undefined
  canEdit: boolean
  canMarkConsent: boolean
}) {
  const [editing, setEditing] = useState<ClientMember | 'new' | null>(null)
  const [archiving, setArchiving] = useState<ClientMember | null>(null)
  const [marking, setMarking] = useState<ClientMember | null>(null)
  const [undoing, setUndoing] = useState<ClientMember | null>(null)
  const thisYear = Number(istToday().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const archive = useArchiveMember(client.id)
  const mark = useMarkPaperConsent(client.id)
  const unmark = useRemovePaperConsent(client.id)
  const title = client.kind === 'CORPORATE' ? 'Employees & travellers' : 'Family & travellers'
  const years = Array.from({ length: thisYear - FIRST_PAPER_YEAR + 1 }, (_, i) => thisYear - i)

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
              <th>Consent form</th>
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
                <td>
                  <ConsentCell
                    member={m}
                    canMark={canMarkConsent}
                    onMark={() => {
                      setYear(thisYear)
                      setMarking(m)
                    }}
                    onUndo={() => setUndoing(m)}
                  />
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

      {marking && (
        <ConfirmDialog
          title={`${marking.name}’s consent was signed on paper?`}
          body="It goes on file with the year it was signed, and they won’t be sent the “I agree” link. Keep the signed paper at the office."
          confirmLabel="Mark on file"
          pending={mark.isPending}
          error={errorText(mark.error)}
          onCancel={() => {
            setMarking(null)
            mark.reset()
          }}
          onConfirm={() => mark.mutate({ memberId: marking.id, year }, { onSuccess: () => setMarking(null) })}
        >
          <label className="field">
            Year it was signed
            <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </ConfirmDialog>
      )}

      {undoing && (
        <ConfirmDialog
          title={`Undo ${undoing.name}’s paper consent?`}
          body="Their consent won’t be on file any more, so they can be sent the “I agree” link. Use this only for a mistake."
          confirmLabel="Undo"
          danger
          pending={unmark.isPending}
          error={errorText(unmark.error)}
          onCancel={() => {
            setUndoing(null)
            unmark.reset()
          }}
          onConfirm={() => unmark.mutate(undoing.id, { onSuccess: () => setUndoing(null) })}
        />
      )}
    </div>
  )
}

/** "On file · 28 Sep", "On file · 2025 (on paper)" or "Not on file", with the mark and undo buttons for those allowed. */
function ConsentCell({ member, canMark, onMark, onUndo }: { member: ClientMember; canMark: boolean; onMark: () => void; onUndo: () => void }) {
  const { consent } = member
  if (!consent) {
    return (
      <span className="consent-cell">
        <span className="chip chip-warn">Not on file</span>
        {canMark && (
          <button type="button" className="btn-link small" onClick={onMark}>
            Signed on paper
          </button>
        )}
      </span>
    )
  }
  if (consent.paperYear !== null) {
    return (
      <span className="consent-cell">
        <span className="chip chip-ok">On file · {consent.paperYear} (on paper)</span>
        {canMark && (
          <button type="button" className="btn-link small" onClick={onUndo}>
            Undo
          </button>
        )}
      </span>
    )
  }
  return <span className="chip chip-ok">On file · {dayMonth(consent.agreedAt)}</span>
}
