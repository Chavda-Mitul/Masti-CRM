import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatMobile } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useSendConsentLink } from '../queries'
import type { CaseTraveller, VisaCase } from '../types'
import { ConsentDetailsDialog } from './ConsentDetailsDialog'
import { dayMonth, travellerTab } from './labels'

/** Where the details can be filled in and the link sent (0022): not at enquiry, then alongside processing until the handover. */
const CONSENT_STAGES = ['DOCUMENTS', 'FILE_PREPARATION', 'DISPATCH', 'AT_VENDOR', 'DECISION', 'PASSPORT_BACK']

/**
 * One traveller: "Agreed · 28 Sep" (or "On file · 2025 (on paper)"), or "None on file — flagged" with where their
 * details and their "I agree" link stand; or "Name this traveller first".
 */
function Tile({
  caseNo,
  clientId,
  traveller,
  onFill,
  canAct,
}: {
  caseNo: string
  clientId: string
  traveller: CaseTraveller
  onFill: () => void
  canAct: boolean
}) {
  const toast = useToast()
  const send = useSendConsentLink(caseNo)
  const { name } = travellerTab(traveller)
  const { consent } = traveller
  if (consent.state === 'UNLINKED') {
    return (
      <div className="consent-tile">
        <strong>{name}</strong>
        <span className="muted">Name this traveller first</span>
      </div>
    )
  }
  if (consent.state === 'ON_FILE') {
    return (
      <div className="consent-tile ok">
        <strong>{name}</strong>
        {consent.paperYear !== null ? `On file · ${consent.paperYear} (on paper)` : `Agreed · ${dayMonth(consent.agreedAt)}`}
        <div className="consent-actions">
          {/* The record opens in a tab of its own, to print or save as PDF (0022 part 3b). Anyone who can open the case. */}
          {traveller.member && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => window.open(`/print/consent/${clientId}/${traveller.member!.id}`, '_blank')}
            >
              View record
            </button>
          )}
          {canAct && (
            <button type="button" className="btn btn-sm" onClick={onFill}>
              Edit details
            </button>
          )}
        </div>
      </div>
    )
  }
  const filled = consent.details.filledAt
  const resend = () =>
    send.mutate(
      { travellerId: traveller.id },
      { onSuccess: () => toast({ tone: 'ok', message: `${consent.link ? 'A new link' : 'The link'} is on its way on WhatsApp.` }) },
    )
  return (
    <div className="consent-tile flagged">
      <strong>{name}</strong>
      None on file — flagged
      <span className="small">{filled ? `Details filled · ${dayMonth(filled)}` : 'Details not filled'}</span>
      {consent.link && (
        <span className="small">
          Link sent · {dayMonth(consent.link.sentAt)} · to <span className="consent-mobile">{formatMobile(consent.link.toMobile)}</span>
        </span>
      )}
      {canAct && (
        <div className="consent-actions">
          <button type="button" className="btn btn-sm" onClick={onFill}>
            {filled ? 'Edit details' : 'Fill details'}
          </button>
          {filled && (
            <button type="button" className="btn btn-sm" disabled={send.isPending} onClick={resend}>
              {send.isPending ? 'Sending…' : consent.link ? 'Send the link again' : 'Send the link'}
            </button>
          )}
        </div>
      )}
      {send.isError && <span className="small consent-error">{errorText(send.error)}</span>}
    </div>
  )
}

/**
 * The consent & liability form (§10.5, docs/decisions/0022-consent-form.md): once per person, for life. Taken in
 * parallel with processing, so it never blocks the case. Staff fill in each traveller's details; saving them sends the
 * client an "I agree" link on WhatsApp, to the traveller's own number if saved.
 */
export function ConsentCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [filling, setFilling] = useState<CaseTraveller | null>(null)
  const canAct =
    !!me && c.status === 'OPEN' && CONSENT_STAGES.includes(c.stage.code) && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad">
      <div className="card-head" style={{ paddingBottom: 4 }}>
        <h2 className="h2">Consent &amp; liability form</h2>
        <span className="muted small">once per person · stays valid if the passport changes</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Staff fill the details by asking the client. Saving them sends the client a WhatsApp link, where they only tap{' '}
        <strong>I agree</strong>.
      </p>
      <div className="consent-tiles">
        {c.travellers.map((t) => (
          <Tile key={t.id} caseNo={c.caseNo} clientId={c.client.id} traveller={t} canAct={canAct} onFill={() => setFilling(t)} />
        ))}
      </div>
      {filling && filling.consent.state !== 'UNLINKED' && (
        <ConsentDetailsDialog caseNo={c.caseNo} traveller={filling} onClose={() => setFilling(null)} />
      )}
    </section>
  )
}
