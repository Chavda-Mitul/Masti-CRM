import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime, formatMonthYear } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { MemberFormDrawer } from '../../clients/MemberFormDrawer'
import { useClient, useClientOptions } from '../../clients/queries'
import { useLinkTraveller, useUpdateCaseDocument } from '../queries'
import type { CaseDocument, CaseTraveller, ReceivedAs, VisaCase } from '../types'
import { REQUIREMENT_LABEL, travellerTab } from './labels'

/** The steps where the checklist can still change; after maturity it is the processor's (0006 Decision 8). */
const COLLECTING = ['ENQUIRY', 'DOCUMENTS']

/** Pending / "In · 3 Oct, 4:12 pm" / "Made · …" / Not needed. */
function StatusChip({ doc }: { doc: CaseDocument }) {
  switch (doc.status) {
    case 'RECEIVED':
      return <span className="chip chip-ok chip-sm">In · {formatDateTime(doc.receivedAt)}</span>
    case 'MADE':
      return <span className="chip chip-ok chip-sm">Made · {formatDateTime(doc.receivedAt)}</span>
    case 'NOT_NEEDED':
      return <span className="chip chip-muted chip-sm">Not needed</span>
    default:
      return <span className="chip chip-warn chip-sm">Pending</span>
  }
}

/**
 * The per-traveller checklist (demo screen 07, §10.4): copied at intake from Masters, ticked as each paper is scanned in
 * the office (0006 Decisions 2 and 3). The case's owner, its HOD and the Head can change it while documents are collected.
 */
export function ChecklistCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [selected, setSelected] = useState(c.travellers[0]?.id)
  const traveller = c.travellers.find((t) => t.id === selected) ?? c.travellers[0]
  if (!traveller) return null
  const editable =
    !!me && c.status === 'OPEN' && COLLECTING.includes(c.stage.code) && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad">
      <div className="card-head">
        <div>
          <h2 className="h2">Document checklist</h2>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Tick each paper as it is scanned at the office — original or xerox.
          </p>
        </div>
        <div className="checklist-count">
          <strong>
            {traveller.done} / {traveller.need}
          </strong>
          <div className="muted small">for {traveller.name ?? traveller.label}</div>
        </div>
      </div>

      {c.stage.code === 'ENQUIRY' && c.status === 'OPEN' && (
        <div className="alert alert-info step-note" role="status">
          This case is still at <strong>Step 1 (Enquiry)</strong>. It moves to Step 2 when you start collecting documents: name a
          traveller, tick a paper, or press “Start collecting documents”.
        </div>
      )}

      {c.travellers.length > 1 && (
        <div className="kind-toggle traveller-tabs" role="tablist" aria-label="Traveller">
          {c.travellers.map((t) => {
            const label = travellerTab(t)
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === traveller.id}
                className={t.id === traveller.id ? 'on' : ''}
                onClick={() => setSelected(t.id)}
              >
                {label.name}
                {label.detail && <span> · {label.detail}</span>}
              </button>
            )
          })}
        </div>
      )}

      <TravellerIdentity key={traveller.id} visaCase={c} traveller={traveller} editable={editable} />

      <div
        className={`checklist${editable ? ' editable' : ''}`}
        role="table"
        aria-label={`Documents for ${traveller.name ?? traveller.label}`}
      >
        <div className="checklist-row head" role="row">
          <span role="columnheader" aria-label="Done" />
          <span role="columnheader">Document</span>
          <span role="columnheader">We need</span>
          <span role="columnheader">Came in as</span>
          <span role="columnheader">Status</span>
          {editable && <span role="columnheader" aria-label="Actions" />}
        </div>
        {traveller.documents.map((d) => (
          <DocumentRow key={d.id} caseNo={c.caseNo} doc={d} editable={editable} />
        ))}
      </div>

      <p className="checklist-foot">
        Clients don’t upload anything — papers are scanned here by the follow-up desk. The checklist comes from Masters →{' '}
        {c.country.label} · {c.visaType.name}.
      </p>
    </section>
  )
}

/**
 * Who this traveller is. "Adult 1" is a placeholder from intake; naming it links the client's family member, which
 * brings the passport and the consent. New people are added to the family on the spot.
 */
function TravellerIdentity({ visaCase: c, traveller, editable }: { visaCase: VisaCase; traveller: CaseTraveller; editable: boolean }) {
  const [changing, setChanging] = useState(false)
  const m = traveller.member

  if (m && !changing) {
    const passport =
      m.passportStatus === 'EXPIRED'
        ? { text: `Passport expired ${formatMonthYear(m.passportExpiry)}`, tone: 'chip-bad' }
        : m.passportStatus === 'RENEW_SOON'
          ? { text: `Passport ${formatMonthYear(m.passportExpiry)} · renew soon`, tone: 'chip-warn' }
          : m.passportStatus === 'VALID'
            ? { text: `Passport till ${formatMonthYear(m.passportExpiry)}`, tone: 'chip-ok' }
            : { text: 'No passport on file', tone: 'chip-muted' }
    return (
      <div className="traveller-identity">
        <div>
          <strong>{m.name}</strong>
          <span className="muted small">
            {' '}
            · {[m.relation?.name, m.age != null ? `${m.age}` : null].filter(Boolean).join(', ') || (traveller.isChild ? 'child' : 'adult')}
          </span>
        </div>
        <span className={`chip chip-sm ${passport.tone}`}>{passport.text}</span>
        {editable && (
          <button type="button" className="btn-link small" onClick={() => setChanging(true)}>
            Change
          </button>
        )}
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="alert alert-warn" role="status">
        “{traveller.label}” isn’t named yet: the enquiry form only asks how many people travel.
      </div>
    )
  }
  return <TravellerPicker visaCase={c} traveller={traveller} onDone={() => setChanging(false)} canCancel={!!m} />
}

function TravellerPicker({
  visaCase: c,
  traveller,
  onDone,
  canCancel,
}: {
  visaCase: VisaCase
  traveller: CaseTraveller
  onDone: () => void
  canCancel: boolean
}) {
  const toast = useToast()
  const client = useClient(c.client.id)
  const options = useClientOptions()
  const link = useLinkTraveller(c.caseNo)
  const [adding, setAdding] = useState(false)

  // Someone already on this case can't be a second traveller.
  const taken = new Set(c.travellers.filter((t) => t.id !== traveller.id && t.member).map((t) => t.member!.id))
  const members = (client.data?.members ?? []).filter((m) => !taken.has(m.id))

  const pick = (memberId: string) =>
    link.mutate(
      { travellerId: traveller.id, memberId },
      {
        onSuccess: onDone,
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t name this traveller. Please try again.' }),
      },
    )

  return (
    <div className="traveller-picker">
      <label className="field" style={{ flex: 1, minWidth: 220 }}>
        <span className="lbl">Who is “{traveller.label}”?</span>
        <select
          className="select"
          value=""
          disabled={client.isPending || link.isPending}
          onChange={(e) => e.target.value && pick(e.target.value)}
        >
          <option value="">{client.isPending ? 'Loading the family…' : members.length ? 'Pick from the family…' : 'No one on the family list yet'}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.relation ? ` · ${m.relation.name}` : ''}
              {m.age != null ? `, ${m.age}` : ''}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" disabled={!options.data || link.isPending} onClick={() => setAdding(true)}>
        + Add person
      </button>
      {canCancel && (
        <button type="button" className="btn-link" onClick={onDone}>
          Cancel
        </button>
      )}
      {adding && options.data && (
        <MemberFormDrawer
          clientId={c.client.id}
          member={null}
          options={options.data}
          onClose={() => setAdding(false)}
          onSaved={(saved) => pick(saved.id)}
        />
      )}
    </div>
  )
}

/** "Came in as" for a paper: the default follows what we need. */
const defaultReceivedAs = (doc: CaseDocument): ReceivedAs => (doc.requirement === 'ORIGINAL' ? 'ORIGINAL' : 'XEROX')

function DocumentRow({ caseNo, doc: d, editable }: { caseNo: string; doc: CaseDocument; editable: boolean }) {
  const toast = useToast()
  const update = useUpdateCaseDocument(caseNo)
  const arranged = d.requirement === 'ARRANGED_BY_US'
  const done = d.status === 'RECEIVED' || d.status === 'MADE'

  const set = (status: CaseDocument['status'], receivedAs: ReceivedAs | null = null) =>
    update.mutate(
      { documentId: d.id, status, receivedAs },
      { onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save that tick. Please try again.' }) },
    )
  const toggle = () => {
    if (done) set('PENDING')
    else if (arranged) set('MADE')
    else set('RECEIVED', defaultReceivedAs(d))
  }

  const busy = update.isPending
  const canTick = editable && d.status !== 'NOT_NEEDED'

  return (
    <div className={`checklist-row${d.status === 'NOT_NEEDED' ? ' off' : ''}${busy ? ' busy' : ''}`} role="row">
      <span role="cell">
        {canTick ? (
          <button
            type="button"
            className={`tick${done ? ' on' : ''}`}
            aria-pressed={done}
            aria-label={done ? `Untick ${d.name}` : `Tick ${d.name}`}
            disabled={busy}
            onClick={toggle}
          >
            {done ? '✓' : ''}
          </button>
        ) : (
          <span className={`tick${done ? ' on' : ''}`} aria-label={done ? 'In' : 'Not in yet'}>
            {done ? '✓' : ''}
          </span>
        )}
      </span>
      <span role="cell">
        <span className="doc-name">
          {d.name}
          {d.quantity > 1 && ` (${d.quantity})`}
        </span>
        {(d.detail || d.note) && <div className="doc-note">{[d.detail, d.note].filter(Boolean).join(' · ')}</div>}
      </span>
      <span role="cell" className="small">
        {REQUIREMENT_LABEL[d.requirement]}
      </span>
      <span role="cell" className="small">
        {arranged ? (
          <span className="muted">{d.status === 'MADE' ? 'Made by us' : '—'}</span>
        ) : editable && d.status !== 'NOT_NEEDED' ? (
          <span className="seg-btn" role="radiogroup" aria-label={`${d.name} came in as`}>
            {(['ORIGINAL', 'XEROX'] as const).map((as) => (
              <button
                key={as}
                type="button"
                role="radio"
                aria-checked={d.receivedAs === as}
                className={d.receivedAs === as ? 'on' : ''}
                disabled={busy}
                onClick={() => d.receivedAs !== as && set('RECEIVED', as)}
              >
                {as === 'ORIGINAL' ? 'Original' : 'Xerox'}
              </button>
            ))}
          </span>
        ) : d.receivedAs === 'ORIGINAL' ? (
          'Original'
        ) : d.receivedAs === 'XEROX' ? (
          'Xerox'
        ) : (
          '—'
        )}
      </span>
      <span role="cell" title={d.receivedBy ? `By ${d.receivedBy.name}` : undefined}>
        <StatusChip doc={d} />
      </span>
      {editable && (
        <span role="cell" className="row-action">
          <button
            type="button"
            className="btn-mini"
            disabled={busy}
            aria-label={d.status === 'NOT_NEEDED' ? `Mark ${d.name} as needed` : `Mark ${d.name} as not needed`}
            onClick={() => set(d.status === 'NOT_NEEDED' ? 'PENDING' : 'NOT_NEEDED')}
          >
            {d.status === 'NOT_NEEDED' ? 'Needed' : 'Not needed'}
          </button>
        </span>
      )}
    </div>
  )
}
