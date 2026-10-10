import { formatDateTime } from '../../../lib/format'
import { dueOf } from '../due'
import type { VisaCase } from '../types'

/** The next follow-up and the log so far (§10.3). "Log call" comes with the follow-up part of Step 2 (0006 Decision 6). */
export function FollowUpsCard({ visaCase: c }: { visaCase: VisaCase }) {
  const due = dueOf(c.dueAt)

  return (
    <section className="card pad">
      <div className="card-head" style={{ paddingBottom: 8 }}>
        <h2 className="h2">Follow-ups</h2>
        <button type="button" className="btn btn-sm" disabled title="Comes with the next part of Step 2">
          Log call <span className="tag">Soon</span>
        </button>
      </div>
      <div className="kv">
        <span>Next follow-up</span>
        <strong className={`due due-${due.tone}`}>{due.text}</strong>
      </div>
      {c.followUps.length === 0 ? (
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          No follow-ups logged yet.
        </p>
      ) : (
        <ul className="follow-list">
          {c.followUps.map((f) => (
            <li key={f.id}>
              <strong>{f.outcome}</strong> → {f.nextStep}
              <div className="muted small">
                {f.by.name} · {formatDateTime(f.createdAt)} · next {formatDateTime(f.nextAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
