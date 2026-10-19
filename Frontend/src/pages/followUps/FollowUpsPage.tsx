import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { canActOnCase, isHodOfAny } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { errorText } from '../../lib/apiErrors'
import { departmentStyle } from '../../lib/departments'
import { formatDateTime } from '../../lib/format'
import '../../styles/enquiries.css'
import { dueOf } from '../enquiries/due'
import { LogCallForm } from '../enquiries/LogCallForm'
import { useFollowUpDesk } from '../enquiries/queries'
import { statusNote } from '../enquiries/status'
import type { FollowUpBucket, FollowUpDesk, FollowUpDeskRow, FollowUpScope } from '../enquiries/types'

const TABS: { value: FollowUpBucket; label: string; count: keyof FollowUpDesk['counts'] }[] = [
  { value: 'OVERDUE', label: 'Overdue', count: 'overdue' },
  { value: 'TODAY', label: 'Today', count: 'today' },
  { value: 'WEEK', label: 'This week', count: 'week' },
  { value: 'POSTPONED', label: 'Postponed', count: 'postponed' },
]

const EMPTY: Record<FollowUpBucket, string> = {
  OVERDUE: 'Nothing overdue.',
  TODAY: 'No follow-ups left for today.',
  WEEK: 'No follow-ups in the next 7 days.',
  POSTPONED: 'No postponed cases.',
}

function bucketOf(param: string | null): FollowUpBucket {
  return TABS.find((t) => t.value === param?.toUpperCase())?.value ?? 'TODAY'
}

/**
 * The follow-up desk (0006 Decision 9, demo screen 21): the calls to make, late first, with an inline "Log call".
 * Overdue · Today · This week · Postponed; the HOD and the Head can switch from their own cases to the whole department.
 * The tab and the switch live in the URL (?tab=week&scope=all), so Back from a case returns to the same view.
 */
export function FollowUpsPage() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const bucket = bucketOf(params.get('tab'))
  const canSeeAll = me ? isHodOfAny(me) : false
  const scope: FollowUpScope = canSeeAll && params.get('scope') === 'all' ? 'ALL' : 'MINE'
  const desk = useFollowUpDesk(bucket, scope)
  const [logging, setLogging] = useState<string | null>(null)

  const setParam = (key: 'tab' | 'scope', value: string) => {
    setLogging(null)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  if (!me) return null
  const rows = desk.data?.rows ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Follow-up desk</h1>
          <p>The follow-up desk chases clients until a case matures, then hands it to processing. Every outcome is picked from a list — no free text.</p>
        </div>
        {canSeeAll && (
          <div className="kind-toggle" role="radiogroup" aria-label="Whose follow-ups">
            {(['MINE', 'ALL'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                className={scope === s ? 'on' : ''}
                onClick={() => setParam('scope', s === 'ALL' ? 'all' : '')}
              >
                {s === 'MINE' ? 'Mine' : me.type === 'HEAD' ? 'Everyone' : 'Whole department'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="kind-toggle desk-tabs" role="tablist" aria-label="Which follow-ups">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={bucket === t.value}
            className={bucket === t.value ? 'on' : ''}
            onClick={() => setParam('tab', t.value === 'TODAY' ? '' : t.value.toLowerCase())}
          >
            {t.label}
            {desk.data && <span className="tab-count">· {desk.data.counts[t.count]}</span>}
          </button>
        ))}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {desk.isPending ? (
          <div className="pad muted">Loading…</div>
        ) : desk.isError ? (
          <div className="pad">
            <div className="alert alert-bad">{errorText(desk.error)}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad muted">{EMPTY[bucket]}</div>
        ) : (
          <table className="table desk-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Client &amp; case</th>
                <th>Desk</th>
                <th>What for</th>
                <th>Last contact</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DeskRow
                  key={row.id}
                  row={row}
                  logging={logging === row.id}
                  canLog={canActOnCase(me, { department: row.department.code, owner: row.owner })}
                  onLog={() => setLogging(row.id)}
                  onClose={() => setLogging(null)}
                  showOwner={scope === 'ALL'}
                />
              ))}
            </tbody>
          </table>
        )}
        {desk.data?.more && <div className="pad muted small">Showing the first {rows.length}. Pick a shorter tab to see the rest.</div>}
      </div>
    </>
  )
}

function DeskRow({
  row,
  logging,
  canLog,
  onLog,
  onClose,
  showOwner,
}: {
  row: FollowUpDeskRow
  logging: boolean
  canLog: boolean
  onLog: () => void
  onClose: () => void
  showOwner: boolean
}) {
  const style = departmentStyle(row.department.code)
  const due = dueOf(row.dueAt)
  return (
    <Fragment>
      <tr className={logging ? 'row-on' : undefined}>
        <td className={`small due due-${due.tone}`} style={{ fontWeight: 800 }}>
          {due.text}
        </td>
        <td>
          <Link to={`/enquiries/${encodeURIComponent(row.caseNo)}`} className="desk-name">
            {row.client.name}
          </Link>
          <div className="muted small ellipsis">
            <span className="mono">{row.caseNo}</span> · {row.summary}
          </div>
        </td>
        <td>
          <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
            {row.department.name}
          </span>
        </td>
        <td className="small">
          {statusNote(row) ?? row.whatFor}
          {showOwner && <div className="muted">{row.owner ? row.owner.name : 'Waiting for the HOD'}</div>}
        </td>
        <td className="small muted">{row.lastContact ? `${row.lastContact.outcome} · ${formatDateTime(row.lastContact.at)}` : '—'}</td>
        <td style={{ textAlign: 'right' }}>
          {logging ? (
            <span className="chip chip-sm chip-info">Logging now</span>
          ) : (
            canLog && (
              <button type="button" className="btn btn-sm" onClick={onLog}>
                Log call
              </button>
            )
          )}
        </td>
      </tr>
      {logging && (
        <tr className="row-on desk-form-row">
          <td colSpan={6}>
            <LogCallForm
              caseNo={row.caseNo}
              departmentCode={row.department.code}
              updatedAt={row.updatedAt}
              postponed={row.status === 'POSTPONED'}
              onDone={onClose}
              onCancel={onClose}
            />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
