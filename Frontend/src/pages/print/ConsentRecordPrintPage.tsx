import { useEffect, type CSSProperties } from 'react'
import { useParams } from 'react-router'
import { useMe } from '../../auth/useAuth'
import { ConsentWording } from '../../components/ConsentWording'
import { errorText, lostAccess } from '../../lib/apiErrors'
import { formatDate, formatMobile, istParts, istToday } from '../../lib/format'
import '../../styles/print.css'
import { useConsentRecord } from '../clients/queries'
import type { ConsentRecord } from '../clients/types'
import { dateTimeWithYear, detailRows } from '../consent/details'

/** The page's margins on A4, in millimetres. */
const EDGE_MM = 18
const SIDE_MM = 20

/**
 * The printable record of one person's consent & liability form (docs/decisions/0022-consent-form.md, part 3b): the
 * proof, printed or saved as PDF from the browser; nothing is stored. Outside the app shell, so only the record prints.
 * Opened from the case's consent card and the client page's family table.
 */
export function ConsentRecordPrintPage() {
  const { clientId = '', memberId = '' } = useParams()
  const record = useConsentRecord(clientId, memberId)
  const { data: me } = useMe()

  // The browser names the tab and the saved PDF after the title: "Rakesh Mehta_Consent_record".
  useEffect(() => {
    if (!record.data) return
    const before = document.title
    document.title = `${record.data.name}_Consent_record`
    return () => {
      document.title = before
    }
  }, [record.data])

  if (record.isPending) return <p className="print-note">Loading…</p>
  if (record.isLoadingError || lostAccess(record)) return <p className="print-note">{errorText(record.error) ?? 'Couldn’t load the consent record.'}</p>

  const r = record.data
  return (
    <div className="print-page letter-print">
      <style>{`@page { size: A4; margin: ${EDGE_MM}mm ${SIDE_MM}mm; }`}</style>
      <div className="print-toolbar">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.close()}>
          Close
        </button>
        <span className="muted small">Print it, or pick “Save as PDF” as the printer.</span>
      </div>
      <div
        className="letter-sheet consent-record"
        style={{ '--letter-top': `${EDGE_MM}mm`, '--letter-edge': `${EDGE_MM}mm`, '--letter-side': `${SIDE_MM}mm` } as CSSProperties}
      >
        <header className="record-head">
          <strong>{r.company.name}</strong>
          <span>{r.company.address}</span>
          <span>
            {r.company.phone}
            {r.company.phone2 && ` · ${r.company.phone2}`}
          </span>
        </header>
        <h1 className="record-title">Consent and liability form: record</h1>
        {r.source === 'LINK' ? <LinkRecord record={r} /> : <PaperRecord record={r} />}
        <footer className="record-foot">
          Printed from Masti CRM on {formatDate(istToday())}
          {me ? ` by ${me.name}` : ''}.
        </footer>
      </div>
    </div>
  )
}

/** Given through the "I agree" link: who, how and when, from where, and the exact words. */
function LinkRecord({ record: r }: { record: Extract<ConsentRecord, { source: 'LINK' }> }) {
  const rows: [string, string][] = [['Name', r.person.name], ['Relation', r.person.relation], ...detailRows(r.person)]
  return (
    <>
      <section>
        <h2>Agreed by</h2>
        <dl className="record-rows">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h2>How it was given</h2>
        <p>
          Agreed on {dateTimeWithYear(r.agreedAt)} (India time) by tapping “I agree” on the link sent on WhatsApp to{' '}
          {formatMobile(r.link.toMobile)} on {dateTimeWithYear(r.link.sentAt)} by {r.link.sentBy}, for case {r.link.caseNo}.
        </p>
        <dl className="record-rows">
          <div>
            <dt>From the network address</dt>
            <dd className="mono">{r.ip ?? '—'}</dd>
          </div>
          <div>
            <dt>On the phone’s browser</dt>
            <dd className="mono">{r.userAgent ?? '—'}</dd>
          </div>
          <div>
            <dt>Wording</dt>
            <dd>
              Version {r.wording.id}, in use from {formatDate(istParts(r.wording.createdAt).date)}
            </dd>
          </div>
        </dl>
      </section>
      <section className="record-wording">
        <h2>The wording they agreed to</h2>
        <ConsentWording body={r.wording.body} />
      </section>
    </>
  )
}

/** Signed on paper before the CRM: the year, and who put it on file when. */
function PaperRecord({ record: r }: { record: Extract<ConsentRecord, { source: 'PAPER' }> }) {
  return (
    <section>
      <h2>{r.name}</h2>
      <p>
        Signed on paper in {r.paperYear}. Marked on file{r.markedBy ? ` by ${r.markedBy}` : ''} on {dateTimeWithYear(r.markedAt)}.
      </p>
      <p>The signed paper is kept at the office.</p>
    </section>
  )
}
