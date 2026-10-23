import type { TodaySummary } from './types'

/**
 * Business lost this month — and why (docs/decisions/0017-today-dashboard.md Decision 5, amendment 2; demo screen 01):
 * the cases that came in this month, as booked, lost (cancelled) or still open, and the top reasons they were lost.
 * No "Open report" link until Reports (Decision 4).
 */
export function BusinessLostCard({ day }: { day: TodaySummary | undefined }) {
  const lost = day?.businessLost
  const most = Math.max(1, ...(lost?.reasons ?? []).map((r) => r.count))

  return (
    <section className="card pad today-lost">
      <div className="today-card-head">
        <h2 className="h2">Business lost this month — and why</h2>
      </div>
      <div className="today-mini-tiles">
        <MiniTile label="Queries in" value={lost?.queriesIn} />
        <MiniTile label="Booked" value={lost?.booked} tone="ok" />
        <MiniTile label="Lost" value={lost?.lost} tone="bad" />
        <MiniTile label="Still open" value={lost?.stillOpen} />
      </div>
      {!lost ? (
        <p className="muted">Loading…</p>
      ) : lost.reasons.length === 0 ? (
        <p className="muted small">Nothing lost this month.</p>
      ) : (
        lost.reasons.map((r) => (
          <div key={r.name} className="today-bar-row today-lost-row">
            <span className="today-lost-name">{r.name}</span>
            <span className="today-bar-track">
              <span style={{ width: `${Math.round((r.count / most) * 100)}%` }} />
            </span>
            <span className="today-bar-count">{r.count}</span>
          </div>
        ))
      )}
    </section>
  )
}

function MiniTile({ label, value, tone }: { label: string; value: number | undefined; tone?: 'ok' | 'bad' }) {
  return (
    <div className={tone ? `today-mini is-${tone}` : 'today-mini'}>
      <span>{label}</span>
      <strong>{value ?? '…'}</strong>
    </div>
  )
}
