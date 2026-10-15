import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import type { VisaCase } from '../types'
import { dayTime, firstName, longDate } from './labels'
import { SubmissionDialog } from './SubmissionDialog'

/**
 * "Expected collection date" (demo screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 4), once the file is
 * submitted: the embassy and the date, and when the file comes back due to check with the vendor. While the file is at
 * Step 5, whoever can act on the case can change the file number or move the date (Change).
 */
export function CollectionCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [changing, setChanging] = useState(false)
  const s = c.submission
  if (!s) return null
  const canChange =
    !!me && c.stage.code === 'AT_VENDOR' && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad dispatch-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 className="h2">Expected collection date</h2>
          <span className="muted small">
            {s.embassy.name} · holidays and Sundays can’t be picked
          </span>
        </div>
        {canChange && (
          <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>
            Change
          </button>
        )}
      </div>
      <div className="collection-picked">
        <span className="muted small">Expected collection</span>
        <strong>{longDate(s.collectionOn)}</strong>
      </div>
      {c.stage.code === 'AT_VENDOR' && c.status === 'OPEN' && c.dueAt && (
        <div className="kv">
          <span>
            {dayTime(c.dueAt)}
            {c.owner && ` · ${firstName(c.owner.name)}`}
          </span>
          <strong>Check with the vendor</strong>
        </div>
      )}
      {changing && <SubmissionDialog visaCase={c} onClose={() => setChanging(false)} />}
    </section>
  )
}
