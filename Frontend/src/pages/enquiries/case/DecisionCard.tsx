import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatDate } from '../../../lib/format'
import type { VisaCase } from '../types'
import { ChangeDecisionDialog } from './ChangeDecisionDialog'
import { dayTime, evisaDone, firstName, weekdayDay, windingDown } from './labels'
import { EvisaLine } from './EvisaLine'
import { RefusalLetterLine } from './RefusalLetterLine'

/**
 * "Decision" (demo screen 11 ⚠️, docs/decisions/0012-visa-decision.md), once it's recorded: each traveller Approved,
 * with the sticker (or e-visa) number and the dates it's valid, or Refused. While the case is at Step 6 it's due back to
 * check the passports are on their way (an e-visa: to let the client know), and whoever can act on the case can correct
 * a traveller's entry (Change, Decision 6), at Passport back too until the handover. A refused traveller's refusal letter is uploaded and opened on their row, at
 * any step and status once decided (Decision 4). An approved e-visa's PDF is uploaded and checked against the passport on
 * its row (docs/decisions/0025-evisa-after-decision.md).
 */
export function DecisionCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [changing, setChanging] = useState<string | null>(null)
  const d = c.decision
  if (!d) return null
  const number = c.submittedOnline ? 'e-Visa' : 'Sticker'
  const canAct = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner })
  // At Decision, or at Passport back until the handover (amended 19 Oct 2026), to put a sticker that doesn't match right.
  // An e-visa sent to the client stays as it went (0025, part 3).
  const canChange = canAct && (c.stage.code === 'DECISION' || c.stage.code === 'PASSPORT_BACK') && c.status === 'OPEN' && !c.evisaSent
  // An e-visa's PDF and its check (0025), at Decision on an open case, until it's sent.
  const canEvisa = canAct && c.stage.code === 'DECISION' && c.status === 'OPEN' && !c.evisaSent
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
              <span className="decision-detail">
                <span className="mono small">
                  {number} {t.decision.visaNo} · valid {formatDate(t.decision.validFrom)} – {formatDate(t.decision.validTo)}
                </span>
                {c.submittedOnline && <EvisaLine visaCase={c} traveller={t} canAct={canEvisa} />}
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
      {/* "Send the e-visa" (0025, part 3): who sent the approved travellers' e-visas to the client, and when. */}
      {c.evisaSent && (
        <div className="kv">
          <span>
            Sent to the client · {dayTime(c.evisaSent.at)}
            {c.evisaSent.by && ` · ${c.evisaSent.by.name}`}
          </span>
          <strong>On WhatsApp, with each e-visa</strong>
        </div>
      )}
      {/* A cancelled case's passports still come back, and it stays due until then (0006 amendment 15). */}
      {c.stage.code === 'DECISION' && (c.status === 'OPEN' || windingDown(c)) && c.dueAt && (
        <div className="kv">
          <span>
            {dayTime(c.dueAt)}
            {c.owner && ` · ${firstName(c.owner.name)}`}
          </span>
          {/* An e-visa's passports never left the office (0008 Decision 11): its PDFs go to the client, then any
              passports we hold go back; with everyone refused there's nothing to send (0025, parts 3–5). */}
          <strong>{!c.submittedOnline ? 'Check the passports are on their way back' : evisaDone(c) ? 'Hand back the passports' : 'Send the e-visa'}</strong>
        </div>
      )}
      {traveller && <ChangeDecisionDialog visaCase={c} traveller={traveller} onClose={() => setChanging(null)} />}
    </section>
  )
}
