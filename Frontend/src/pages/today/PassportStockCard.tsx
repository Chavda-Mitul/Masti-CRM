import type { Booklets, PassportStock } from './types'

const total = (b: Booklets) => b.current + b.old
/** "18 current + 5 old", as booklets are counted at intake. */
const split = (b: Booklets) => `${b.current} current + ${b.old} old`

/**
 * The passport booklets we hold (change request 23, docs/decisions/0017-today-dashboard.md amendment 3), for the Head
 * and the Visa HOD: how many are in our office now, and how many are out of it (with the vendors, on the way back, and
 * missing from a short return, only when some are). Each step that moves passports changes the numbers.
 */
export function PassportStockCard({ stock }: { stock: PassportStock }) {
  const here = total(stock.inOffice)
  return (
    <section className="card pad today-stock">
      <h2 className="h2">Passport booklets</h2>
      <div className="today-stock-here">
        <strong className="today-stock-value">{here}</strong>
        <span>
          <span className="today-stock-label">in our office</span>
          <span className="muted small">{split(stock.inOffice)}</span>
        </span>
      </div>
      <div className="today-stock-out">
        <h3 className="today-stock-sub">Out of the office</h3>
        <StockRow label="With vendors" booklets={stock.withVendors} />
        <StockRow label="On the way back" booklets={stock.onTheWayBack} />
        {total(stock.missing) > 0 && <StockRow label="Missing" booklets={stock.missing} bad />}
      </div>
    </section>
  )
}

function StockRow({ label, booklets, bad }: { label: string; booklets: Booklets; bad?: boolean }) {
  return (
    <div className={bad ? 'today-stock-row is-bad' : 'today-stock-row'}>
      <span className="today-stock-name">{label}</span>
      <span className="muted small">{split(booklets)}</span>
      <strong>{total(booklets)}</strong>
    </div>
  )
}
