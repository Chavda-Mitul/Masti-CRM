import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatDate } from '../../../lib/format'
import type { VisaCase } from '../types'
import { ChangeDecisionDialog } from './ChangeDecisionDialog'
import { dayTime, firstName, weekdayDay, windingDown } from './labels'
import { RefusalLetterLine } from './RefusalLetterLine'

/**
 * "Decision" (demo screen 11 ⚠️, docs/decisions/0012-visa-decision.md), once it's recorded: each traveller Approved,
 * with the sticker (or e-visa) number and the dates it's valid, or Refused. While the case is at Step 6 it's due back to
 * check the passports are on their way (an e-visa: to let the client know), and whoever can act on the case can correct
 * a traveller's entry (Change, Decision 6), at Passport back too until the handover. A refused traveller's refusal letter is uploaded and opened on their row, at
 * any step and status once decided (Decision 4).
 */
export function DecisionCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [changing, setChanging] = useState<string | null>(null)
  const d = c.decision
  if (!d) return null
  const number = c.submittedOnline ? 'e-Visa' : 'Sticker'
  const canAct = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner })
  // At Decision, or at Passport back until the handover (amended 19 Oct 2026), to put a sticker that doesn't match right.
  const canChange = canAct && (c.stage.code === 'DECISION' || c.stage.code === 'PASSPORT_BACK') && c.status === 'OPEN'
  const traveller = c.travellers.find((t) => t.id === changing)

  return (
    <section className="card pad decision-card">
      <div className="decision-card-head">
        <h2 className="h2">Decision · recorded {weekdayDay(d.at)}</h2>
        <span className="muted small">
          two outcomes, per traveller{d.by && ` · ${d.by.name}`}
        </span>
      </div>
      {c.travellers.map((t) => (
        <div key={t.id} className="decision-line">
          <strong>{t.name ?? t.label}</strong>
          {t.decision?.outcome === 'APPROVED' ? (
            <>
              <span className="chip chip-ok">Approved</span>
              <span className="mono small">
                {number} {t.decision.visaNo} · valid {formatDate(t.decision.validFrom)} – {formatDate(t.decision.validTo)}
              </span>
            </>
          ) : t.decision?.outcome === 'REFUSED' ? (
            <>
              <span className="chip chip-bad">Refused</span>
              <RefusalLetterLine visaCase={c} traveller={t} canUpload={canAct} />
            </>
          ) : (
            <span className="muted small">Not recorded</span>
          )}
          {canChange && (
            <button type="button" className="btn btn-sm" onClick={() => setChanging(t.id)}>
              Change
            </button>
          )}
        </div>
      ))}
      {/* A cancelled case's passports still come back, and it stays due until then (0006 amendment 15). */}
      {c.stage.code === 'DECISION' && (c.status === 'OPEN' || windingDown(c)) && c.dueAt && (
        <div className="kv">
          <span>
            {dayTime(c.dueAt)}
            {c.owner && ` · ${firstName(c.owner.name)}`}
          </span>
          {/* An e-visa's passports never left the office (0008 Decision 11); what follows it waits on M39. */}
          <strong>{c.submittedOnline ? 'Let the client know' : 'Check the passports are on their way back'}</strong>
        </div>
      )}
      {traveller && <ChangeDecisionDialog visaCase={c} traveller={traveller} onClose={() => setChanging(null)} />}
    </section>
  )
}
