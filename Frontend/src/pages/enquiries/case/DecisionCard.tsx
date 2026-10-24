import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import type { VisaCase } from '../types'
import { ChangeDecisionDialog } from './ChangeDecisionDialog'
import { dayTime, evisaDone, firstName, visaDetails, weekdayDay, windingDown } from './labels'
import { EvisaLine } from './EvisaLine'
import { TravellerFileLine } from './TravellerFileLine'

/**
 * "Decision" (demo screen 11 ⚠️, docs/decisions/0012-visa-decision.md), once it's recorded: each traveller Approved,
 * with the sticker (or e-visa) number and the dates it's valid once added (each optional, amended 23 Oct 2026), or
 * Refused. While the case is at Step 6 it's due back to check the passports are on their way (an e-visa: to let the
 * client know), and whoever can act on the case can correct a traveller's entry or add the number and dates (Change,
 * Decision 6; "Add sticker no." while there are none), at Passport back too until the handover. A refused traveller's
 * refusal letter, and an approved paper visa's visa copy (amended 24 Oct 2026, change request 21), are uploaded and
 * opened on their row, at any step and status once decided (Decision 4). An approved e-visa's PDF is uploaded on its
 * row (docs/decisions/0025-evisa-after-decision.md). Each upload goes to the client on WhatsApp (change request 21
 * part 3).
 */
export function DecisionCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [changing, setChanging] = useState<string | null>(null)
  const d = c.decision
  if (!d) return null
  const online = !!c.submittedOnline
  const canAct = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner })
  // At Decision, or at Passport back until the handover (amended 19 Oct 2026), to put a sticker that doesn't match right.
  // An e-visa whose e-visas have all gone stays as it went (0025, part 3).
  const canChange = canAct && (c.stage.code === 'DECISION' || c.stage.code === 'PASSPORT_BACK') && c.status === 'OPEN' && !c.evisaSent
  // An e-visa's PDF (0025): at Decision on an open case until every approved one has gone; after that a corrected one,
  // whatever the case's status, once Delivered too (change request 21 part 3). As the server's EVISA_FILES.
  const canEvisa =
    canAct && (c.evisaSent ? c.stage.code === 'DECISION' || c.stage.code === 'DELIVERED' : c.stage.code === 'DECISION' && c.status === 'OPEN')
  const traveller = c.travellers.find((t) => t.id === changing)

  return (
    <section className="card pad decision-card">
      <div className="decision-card-head">
        <h2 className="h2">Decision · recorded {weekdayDay(d.at)}</h2>
        <span className="muted small">
          two outcomes, per traveller{d.by && ` · ${d.by.name}`}
        </span>
      </div>
      {c.travellers.map((t) => {
        const approved = t.decision?.outcome === 'APPROVED'
        const details = approved && visaDetails(t.decision!, online)
        return (
          <div key={t.id} className="decision-line">
            <strong>{t.name ?? t.label}</strong>
            {approved ? (
              <>
                <span className="chip chip-ok">Approved</span>
                <span className="decision-detail">
                  {details && <span className="mono small">{details}</span>}
                  {online ? (
                    <EvisaLine visaCase={c} traveller={t} canAct={canEvisa} />
                  ) : (
                    <TravellerFileLine visaCase={c} traveller={t} kind="VISA_COPY" file={t.visaCopy} canUpload={canAct} />
                  )}
                </span>
              </>
            ) : t.decision?.outcome === 'REFUSED' ? (
              <>
                <span className="chip chip-bad">Refused</span>
                <TravellerFileLine visaCase={c} traveller={t} kind="REFUSAL_LETTER" file={t.refusalLetter} canUpload={canAct} />
              </>
            ) : (
              <span className="muted small">Not recorded</span>
            )}
            {canChange && (
              <button type="button" className="btn btn-sm" onClick={() => setChanging(t.id)}>
                {approved && !details ? `Add ${online ? 'e-visa' : 'sticker'} no.` : 'Change'}
              </button>
            )}
          </div>
        )
      })}
      {/* Every approved traveller's e-visa has gone to the client (0025, part 3; each as uploaded, change request 21). */}
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
          {/* An e-visa's passports never left the office (0008 Decision 11): its PDFs go to the client as they're
              uploaded, then any passports we hold go back; with everyone refused there's nothing to send (0025, parts
              3–5; change request 21 part 3). */}
          <strong>{!c.submittedOnline ? 'Check the passports are on their way back' : evisaDone(c) ? 'Hand back the passports' : 'Upload the e-visa'}</strong>
        </div>
      )}
      {traveller && <ChangeDecisionDialog visaCase={c} traveller={traveller} onClose={() => setChanging(null)} />}
    </section>
  )
}
