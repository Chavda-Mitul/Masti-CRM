import type { VisaCase } from '../types'

const ARRIVAL_LABEL = { CLIENT_BRINGS: 'Client brings them', COLLECTION_BOY: 'Send collection boy' } as const

/** "How the documents reach us" (demo screen 07): read-only until the next part of Step 2 (0006 Decision 4). */
export function ArrivalCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { current, old } = c.booklets
  const counted = current !== null || old !== null

  return (
    <section className="card pad">
      <h2 className="h2" style={{ marginBottom: 8 }}>
        How the documents reach us
      </h2>
      <div className="kv">
        <span>How</span>
        <strong>{c.arrival ? ARRIVAL_LABEL[c.arrival] : <span className="muted">Not set yet</span>}</strong>
      </div>
      {c.arrival === 'COLLECTION_BOY' && (
        <div className="kv">
          <span>Collection boy</span>
          <span className="muted">Comes with the field app</span>
        </div>
      )}
      <div className="kv">
        <span>Booklets received</span>
        <strong>{counted ? `${current ?? 0} current + ${old ?? 0} old` : <span className="muted">Not counted yet</span>}</strong>
      </div>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        The booklet count is checked again at handover.
      </p>
    </section>
  )
}
