import { needsLooking, outcomeWords, usedWhen } from './labels'
import type { PortalUse } from './types'

/** The last logins the helper collected, for the Head and the HODs (demo screen 28: "Neha · France portal · 12:04"). */
export function WhoUsedWhatCard({ uses }: { uses: PortalUse[] }) {
  return (
    <section className="card pad who-used" aria-label="Who used what">
      <h2 className="who-used-title">Who used what</h2>
      {uses.length === 0 ? (
        <p className="muted small">Nobody has used a portal yet.</p>
      ) : (
        <ul className="who-used-list">
          {uses.map((use) => (
            <li key={use.id}>
              <span>
                {use.user.name} · {use.portal.name}
              </span>
              <span className={needsLooking(use.outcome) ? 'who-used-when portal-warn' : 'who-used-when muted'}>
                {usedWhen(use.at)} · {outcomeWords(use.outcome)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
