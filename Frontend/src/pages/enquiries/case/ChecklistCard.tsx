import { useState } from 'react'
import { formatDateTime } from '../../../lib/format'
import type { CaseDocument, VisaCase } from '../types'
import { REQUIREMENT_LABEL, travellerTab } from './labels'

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
 * the office. Read-only for now: ticking and naming travellers come next (0006 Decisions 2 and 3).
 */
export function ChecklistCard({ visaCase: c }: { visaCase: VisaCase }) {
  const [selected, setSelected] = useState(c.travellers[0]?.id)
  const traveller = c.travellers.find((t) => t.id === selected) ?? c.travellers[0]
  if (!traveller) return null
  const tab = travellerTab(traveller)

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

      {!traveller.member && (
        <div className="alert alert-warn" role="status">
          “{tab.name}” is a placeholder: the enquiry form only asks how many people travel. Soon you’ll pick which family member
          this is, right here, and their passport and consent will show.
        </div>
      )}

      <div className="checklist" role="table" aria-label={`Documents for ${traveller.name ?? traveller.label}`}>
        <div className="checklist-row head" role="row">
          <span role="columnheader" aria-label="Done" />
          <span role="columnheader">Document</span>
          <span role="columnheader">We need</span>
          <span role="columnheader">Came in as</span>
          <span role="columnheader">Status</span>
        </div>
        {traveller.documents.map((d) => {
          const done = d.status === 'RECEIVED' || d.status === 'MADE'
          return (
            <div key={d.id} className={`checklist-row${d.status === 'NOT_NEEDED' ? ' off' : ''}`} role="row">
              <span role="cell">
                <span className={`tick${done ? ' on' : ''}`} aria-label={done ? 'In' : 'Not in yet'}>
                  {done ? '✓' : ''}
                </span>
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
                {d.receivedAs === 'ORIGINAL' ? 'Original' : d.receivedAs === 'XEROX' ? 'Xerox' : '—'}
              </span>
              <span role="cell" title={d.receivedBy ? `By ${d.receivedBy.name}` : undefined}>
                <StatusChip doc={d} />
              </span>
            </div>
          )
        })}
      </div>

      <p className="checklist-foot">
        Clients don’t upload anything — papers are scanned here by the follow-up desk. The checklist comes from Masters →{' '}
        {c.country.label} · {c.visaType.name}.
      </p>
    </section>
  )
}
