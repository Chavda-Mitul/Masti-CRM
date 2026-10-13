import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { formatRupees } from '../../../lib/money'
import type { VisaCase } from '../types'
import { dayMonth } from './labels'
import { QuoteDialog } from './QuoteDialog'

/** The quote can change from Step 1 until the file goes to the vendor (Backend caseLock.ts QUOTING). */
const QUOTE_STEPS = ['ENQUIRY', 'DOCUMENTS', 'FILE_PREPARATION', 'DISPATCH']

/**
 * "Money on this case" (demo screen 09 ⚠️, docs/decisions/0009-visa-invoice.md Decision 2): the quote, each traveller's
 * amount, Masti's service charge, GST on it and the total. The case's owner, its HOD or the Head add or edit it until the
 * file goes to the vendor. The invoice joins this section with a later component.
 */
export function MoneySection({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [editing, setEditing] = useState(false)
  const q = c.quote
  const canEdit =
    !!me && c.status === 'OPEN' && QUOTE_STEPS.includes(c.stage.code) && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <div className="rail-section money-section">
      <div className="lbl">Money on this case</div>
      {q ? (
        <>
          <div className="money-rows">
            {c.travellers.map((t) => {
              const line = q.lines.find((l) => l.travellerId === t.id)
              return (
                <div key={t.id} className="kv">
                  <span>{t.member?.name ?? t.name ?? t.label}</span>
                  <span>{line ? formatRupees(line.totalPaise) : '—'}</span>
                </div>
              )
            })}
            <div className="kv">
              <span>Service charge</span>
              <span>{formatRupees(q.serviceChargePaise)}</span>
            </div>
            <div className="kv">
              <span>GST {q.gstRatePercent}%</span>
              <span>{formatRupees(q.gstPaise)}</span>
            </div>
            <div className="kv money-total">
              <span>Total</span>
              <strong>{formatRupees(q.totalPaise)}</strong>
            </div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {q.processingSpeed.name} processing · quoted by {q.updatedBy.name}, {dayMonth(q.updatedAt)}
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          No quote yet.
        </p>
      )}
      {canEdit && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setEditing(true)}>
          {q ? 'Edit quote' : 'Add quote'}
        </button>
      )}
      {editing && <QuoteDialog visaCase={c} onClose={() => setEditing(false)} />}
    </div>
  )
}
