import { Link } from 'react-router'
import { formatMobile, initials } from '../../../lib/format'
import type { VisaCase } from '../types'
import { isFollowUpStep } from './labels'

/**
 * The right rail (demo screen 07): who the case is for and whose job it is now. "Sent to the client" and "Money on this
 * case" join it with WhatsApp and Accounts.
 */
export function CaseRail({ visaCase: c }: { visaCase: VisaCase }) {
  return (
    <aside className="card pad">
      <div className="rail-section">
        <div className="lbl">Who it is for</div>
        <div className="rail-person">
          <span className="avatar">{initials(c.client.name)}</span>
          <div>
            <Link to={`/clients/${c.client.id}`}>
              <strong>{c.client.name}</strong>
            </Link>
            <span className="mono small">{formatMobile(c.client.mobile)}</span>
          </div>
        </div>
      </div>

      <div className="rail-section">
        <div className="lbl">Whose job it is now</div>
        {c.owner ? (
          <div className="rail-person">
            <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--on-fill)' }}>
              {initials(c.owner.name)}
            </span>
            <div>
              <strong>{c.owner.name}</strong>
              <span className="muted small">{isFollowUpStep(c) ? 'Follow-up' : 'Processing'}</span>
            </div>
          </div>
        ) : (
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            Waiting for the HOD to pick a processor.
          </p>
        )}
      </div>
    </aside>
  )
}
