import { Link } from 'react-router'
import { departmentStyle, SELLING_DEPARTMENTS } from '../../lib/departments'
import type { TodaySummary } from './types'

/** The selling departments get a bar; any other department (Accounts…) only when it has open cases, as on the list. */
const SELLING = new Set<string>(SELLING_DEPARTMENTS)

/**
 * Open enquiries by department (docs/decisions/0017-today-dashboard.md Decision 10, demo screen 01): what the list's
 * Open tab counts, for the person's own cases where they don't lead the department. A row opens that list.
 */
export function DepartmentBarsCard({ day }: { day: TodaySummary | undefined }) {
  const rows = (day?.openByDepartment ?? []).filter((d) => SELLING.has(d.code) || d.count > 0)
  const most = Math.max(1, ...rows.map((d) => d.count))

  return (
    <section className="card pad today-bars">
      <div className="today-card-head">
        <h2 className="h2">Open enquiries</h2>
        <span className="muted small">by department</span>
      </div>
      {!day ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        // e.g. Accounts staff: Accounts gets a bar only when it has open cases.
        <p className="muted">None of your departments takes enquiries.</p>
      ) : (
        rows.map((d) => {
          const style = departmentStyle(d.code)
          return (
            <Link key={d.code} to={`/enquiries?department=${d.code}${d.mine ? '&mine=true' : ''}`} className="today-bar-row">
              <span className="today-bar-name">{d.name}</span>
              <span className="today-bar-track">
                <span style={{ width: `${Math.round((d.count / most) * 100)}%`, background: style.solid }} />
              </span>
              <span className="today-bar-count">{d.count}</span>
            </Link>
          )
        })
      )}
    </section>
  )
}
