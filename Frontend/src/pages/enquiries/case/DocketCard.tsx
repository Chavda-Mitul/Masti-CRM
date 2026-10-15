import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { istParts, istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useAddToDocket, useTakeOutOfDocket } from '../queries'
import type { CaseDocket, DocketKind, VisaCase } from '../types'
import { dayMonth, passportTotal } from './labels'

/** The demo's two-way switch ⚠️ (screen 09). */
const KIND_LABEL: Record<DocketKind, string> = { OWN: 'One file per docket', GROUP: 'Several files in one' }

/** "4", or "4 (+3 old)" */
const passports = (current: number, old: number) => (old > 0 ? `${current} (+${old} old)` : String(current))


/** "Mehta · France" */
const caseLabel = (r: CaseDocket['cases'][number]) => [r.family, r.country].filter(Boolean).join(' · ')

/**
 * The Invoice column (demo screen 09 ⚠️, docs/decisions/0009-visa-invoice.md component 4): the case's locked invoice, or
 * "Raise invoice first". On this case's own row, whoever can act on it jumps to Money on this case to raise it.
 */
function InvoiceCell({ row, canRaise }: { row: CaseDocket['cases'][number]; canRaise: boolean }) {
  if (row.invoiceNo)
    return (
      <span className="chip chip-ok chip-sm">
        <span className="mono">{row.invoiceNo}</span> · locked
      </span>
    )
  if (row.isThisCase && canRaise)
    return (
      <button
        type="button"
        className="chip chip-warn chip-sm docket-raise"
        onClick={() => document.getElementById('money')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        Raise invoice first →
      </button>
    )
  return <span className="chip chip-warn chip-sm">Raise invoice first</span>
}

/**
 * The docket (demo screen 09 ⚠️, docs/decisions/0008-visa-docket-dispatch.md Decisions 2, 4 and 10): at Docket & dispatch
 * the processor, the HOD or the Head adds the file to its vendor's shared docket ("Several files in one") or sends it in
 * a docket of its own ("One file per docket"), and can take it out again until the docket is dispatched. The table shows
 * every file in the docket, with its passports and its invoice. Once dispatched it stays, read-only. E-visas (no
 * vendor) have no docket: the Submit online card stands in its place. A case whose Vendor needed was switched off after
 * it joined a docket still shows it, so it can be taken out and submitted online instead.
 */
export function DocketCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const add = useAddToDocket(c.caseNo)
  const takeOut = useTakeOutOfDocket(c.caseNo)
  const [mode, setMode] = useState<DocketKind>('GROUP')
  // Read-only once dispatched, until Step 5 has its own cards (canAct needs Docket & dispatch).
  const shown = c.stage.code === 'DISPATCH' || c.docket?.status === 'DISPATCHED'
  if (!shown || !c.vendor || (!c.vendorNeeded && !c.docket)) return null

  const d = c.docket
  const canAct = !!me && c.stage.code === 'DISPATCH' && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const busy = add.isPending || takeOut.isPending
  const vendor = d?.vendor ?? c.vendor
  const kind = d?.kind ?? mode
  const onError = (err: unknown) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save. Please try again.' })
  // A vendor switched off, or no longer covering the country, since the file was ready: the server refuses the add.
  const vendorProblem = !c.vendor.isActive
    ? `${c.vendor.name} is switched off. Ask the Visa HOD to switch it back on.`
    : !c.vendor.coversCountry
      ? `${c.vendor.name} no longer covers ${c.country.name}. Ask the Visa HOD.`
      : null

  const addLabel = mode === 'OWN' ? 'Send on its own' : c.openDocket ? `Add to docket ${c.openDocket.docketNo}` : 'Start a docket'
  const pressAdd = () =>
    add.mutate(
      { mode, updatedAt: c.updatedAt },
      { onSuccess: (updated) => toast({ tone: 'ok', message: `Added to docket ${updated.docket?.docketNo ?? ''}.` }), onError },
    )
  const pressTakeOut = () =>
    takeOut.mutate(
      { updatedAt: c.updatedAt },
      { onSuccess: () => toast({ tone: 'ok', message: `Taken out of docket ${d?.docketNo ?? ''}.` }), onError },
    )

  return (
    <section className="card pad docket-card" id="docket">
      <div className="docket-head">
        <h2 className="h2">
          {d ? `Docket ${d.docketNo}` : 'Docket'} · to {vendor.name}, {vendor.city}
        </h2>
        <div className="seg-btn" role="radiogroup" aria-label="How this file goes">
          {(['OWN', 'GROUP'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              disabled={!!d || !canAct || busy}
              onClick={() => setMode(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {d ? (
        <>
          <div className="docket-table-wrap">
            <table className="table docket-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Passports</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {d.cases.map((r) => (
                  <tr key={r.caseNo} className={r.isThisCase ? 'this-case' : undefined} aria-current={r.isThisCase || undefined}>
                    <td>
                      <span className="mono">{r.caseNo}</span>
                      {caseLabel(r) && ` · ${caseLabel(r)}`}
                    </td>
                    <td>{passports(r.passports, r.oldPassports)}</td>
                    <td>
                      <InvoiceCell row={r} canRaise={canAct} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    {d.cases.length} {d.cases.length === 1 ? 'file' : 'files'}
                  </td>
                  <td colSpan={2}>{passportTotal(d.totalPassports, d.totalOldPassports)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {d.status === 'OPEN' && istParts(d.openedAt).date < istToday() && (
            <p className="docket-open-since">Open since {dayMonth(d.openedAt)}, not sent yet.</p>
          )}
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Not in a docket yet.{' '}
          {mode === 'OWN'
            ? 'It goes in a docket of its own; no other file joins it.'
            : c.openDocket
              ? `It joins docket ${c.openDocket.docketNo}, with ${c.openDocket.caseCount} other ${c.openDocket.caseCount === 1 ? 'file' : 'files'} for ${vendor.name}.`
              : `It starts ${vendor.name}’s docket; files ready later join it.`}
        </p>
      )}

      {!d && vendorProblem && <div className="alert alert-warn">{vendorProblem}</div>}

      <p className="muted small" style={{ margin: 0 }}>
        A file can’t leave without its invoice. The invoice is built from the price quoted at the start — nobody types amounts — and can never be
        edited. Extra costs later go on one additional invoice, never more.
      </p>

      {canAct && (
        <div className="docket-actions">
          {!d && !vendorProblem && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={pressAdd}>
              {add.isPending ? 'Adding…' : addLabel}
            </button>
          )}
          {d?.status === 'OPEN' && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={pressTakeOut}>
              {takeOut.isPending ? 'Taking out…' : 'Take out of docket'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
