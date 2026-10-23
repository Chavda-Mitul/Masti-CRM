// The demo's Money to collect card, kept in its layout until its numbers exist
// (docs/decisions/0017-today-dashboard.md Decision 4).

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
