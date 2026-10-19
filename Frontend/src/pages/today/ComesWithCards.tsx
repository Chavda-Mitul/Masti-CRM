// The demo's Business lost and Money to collect cards, kept in its layout until their numbers exist
// (docs/decisions/0017-today-dashboard.md Decisions 4 and 5).

/** Comes with marking enquiries lost: cancelled isn't counted as lost (Decision 5). */
export function BusinessLostCard() {
  return (
    <section className="card pad today-lost">
      <div className="today-card-head">
        <h2 className="h2">Business lost this month — and why</h2>
      </div>
      <div className="today-mini-tiles">
        <MiniTile label="Queries in" />
        <MiniTile label="Booked" tone="ok" />
        <MiniTile label="Lost" tone="bad" />
        <MiniTile label="Still open" />
      </div>
      <p className="muted small">Comes with marking enquiries lost.</p>
    </section>
  )
}

/** Comes with Accounts (Stage 3). */
export function MoneyToCollectCard() {
  return (
    <section className="card pad today-money">
      <h2 className="h2">Money to collect</h2>
      <strong className="today-money-value">—</strong>
      <span className="muted small">Comes with Accounts: payments, the outstanding amount and invoice follow-ups.</span>
    </section>
  )
}

function MiniTile({ label, tone }: { label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={tone ? `today-mini is-${tone}` : 'today-mini'}>
      <span>{label}</span>
      <strong>—</strong>
    </div>
  )
}
