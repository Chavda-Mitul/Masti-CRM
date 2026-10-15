import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatRupees } from '../../../lib/money'
import type { VisaCase } from '../types'
import { useOpenCaseFile } from '../queries'
import { liveInvoice, weekdayDay } from './labels'
import { RecallDialog } from './RecallDialog'

/**
 * "Take the file back (recall)" (demo screen 10 ⚠️, docs/decisions/0011-visa-at-vendor.md Decision 6), for a file at the
 * vendor: what goes back (the embassy fee), what's kept, and that only an HOD can return more. Once taken back: when,
 * why, and the credit note that gave the fee back.
 */
export function RecallCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const openFile = useOpenCaseFile(c.caseNo)
  const [recalling, setRecalling] = useState(false)
  const r = c.recall

  if (r) {
    return (
      <section className="card pad dispatch-card">
        <h2 className="h2">Taken back from the vendor</h2>
        <div>
          <div className="kv">
            <span>Recalled</span>
            <strong>
              {weekdayDay(r.at)} · {r.reason}
              {r.by && ` · ${r.by.name}`}
            </strong>
          </div>
          <div className="kv">
            <span>Credit note</span>
            {r.creditNote ? (
              <span>
                <span className="mono">{r.creditNote.creditNoteNo}</span> · {formatRupees(r.creditNote.totalPaise)}{' '}
                <button type="button" className="btn-link small" onClick={() => openFile(r.creditNote!.file.id)}>
                  Open
                </button>
              </span>
            ) : (
              <span className="muted">Nothing given back</span>
            )}
          </div>
        </div>
      </section>
    )
  }

  if (c.stage.code !== 'AT_VENDOR' || c.docket?.status !== 'DISPATCHED') return null
  const invoice = liveInvoice(c)
  const canAct = !!me && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  // The standing invoice was raised from this quote, which is frozen since: its embassy fees are what goes back.
  const embassyFees = (c.quote?.lines ?? []).reduce((n, l) => n + (l.form === 'ITEMISED' ? (l.embassyFeePaise ?? 0) : 0), 0)
  return (
    <section className="card pad dispatch-card">
      <h2 className="h2">Take the file back (recall)</h2>
      <p className="muted small" style={{ margin: 0 }}>
        When the embassy will take longer than the client can wait, the papers come back unsubmitted.
      </p>
      <div>
        <div className="kv">
          <span>Credit note — embassy fee only</span>
          <strong>{invoice ? formatRupees(embassyFees) : '—'}</strong>
        </div>
        <div className="kv">
          <span>VFS, service charge, courier both ways</span>
          <span className="muted">kept</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="small" style={{ flexGrow: 1 }}>
          Only an <strong>HOD</strong> can return more, case by case.
        </span>
        {canAct && invoice && (
          <button type="button" className="btn btn-sm" onClick={() => setRecalling(true)}>
            Take the file back
          </button>
        )}
      </div>
      {recalling && <RecallDialog visaCase={c} onClose={() => setRecalling(false)} />}
    </section>
  )
}
