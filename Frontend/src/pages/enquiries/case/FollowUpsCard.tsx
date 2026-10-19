import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatDateTime } from '../../../lib/format'
import { dueOf } from '../due'
import { LogCallForm } from '../LogCallForm'
import type { VisaCase } from '../types'

/** The next follow-up, "Log call" and the log so far (§10.3, 0006 Decision 6). */
export function FollowUpsCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [logging, setLogging] = useState(false)
  const due = dueOf(c.dueAt)
  const canLog =
    !!me && (c.status === 'OPEN' || c.status === 'POSTPONED') && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad">
      <div className="card-head" style={{ paddingBottom: 8 }}>
        <h2 className="h2">Follow-ups</h2>
        {canLog && !logging && (
          <button type="button" className="btn btn-sm" onClick={() => setLogging(true)}>
            Log call
          </button>
        )}
      </div>
      {logging && (
        <LogCallForm
          caseNo={c.caseNo}
          departmentCode={c.department.code}
          updatedAt={c.updatedAt}
          postponed={c.status === 'POSTPONED'}
          onDone={() => setLogging(false)}
          onCancel={() => setLogging(false)}
        />
      )}
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
