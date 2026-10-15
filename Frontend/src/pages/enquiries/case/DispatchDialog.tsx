import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { errorBody, errorCode, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { enquiryKeys, useDispatchCheck, useDispatchDocket } from '../queries'
import type { DispatchCheck, VisaCase } from '../types'
import { dayTime } from './labels'

/** "4", or "4 (+3 old)" */
const passports = (current: number, old: number) => (old > 0 ? `${current} (+${old} old)` : String(current))

/** Where each kind of blocker is fixed. A file's invoice is raised on its own case page. */
function fixLink(kind: DispatchCheck['blockers'][number]['kind']) {
  if (kind === 'VENDOR_OFF') return <Link to="/settings/masters/lists?tab=vendors">Open Vendors</Link>
  return null
}

/**
 * "Dispatch docket D-…" (demo screen 09 ⚠️, docs/decisions/0008-visa-docket-dispatch.md Decisions 6 and 9): what stops
 * it, or every file going with its passports and invoice, the courier (a fixed list) and its slip number, and when the
 * files come back due on their processors' desks. The files shown are sent back, so a file added or taken out
 * meanwhile makes it stale.
 */
export function DispatchDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const check = useDispatchCheck(c.caseNo)
  const couriers = useMasterList('couriers')
  const dispatch = useDispatchDocket(c.caseNo)
  const [courierId, setCourierId] = useState('')
  const [awbNo, setAwbNo] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const d = c.docket!

  const options = (couriers.data ?? []).filter((x) => x.isActive)
  const courier = options.find((x) => String(x.id) === courierId)
  // The server's list wins when it disagrees (an invoice or the vendor changed meanwhile).
  const serverBlockers =
    errorCode(dispatch.error) === 'DISPATCH_BLOCKED' ? (errorBody(dispatch.error)?.details?.blockers as DispatchCheck['blockers'] | undefined) : undefined
  const blockers = serverBlockers ?? check.data?.blockers ?? []
  const message = serverBlockers || errorBody(dispatch.error)?.issues ? null : errorText(dispatch.error)
  const ready = !!check.data && blockers.length === 0

  const submit = () => {
    const missing: Record<string, string> = {}
    if (!courier) missing.courierId = 'Pick the courier.'
    if (courier?.awbNeeded && !awbNo.trim()) missing.awbNo = 'Enter the slip (AWB) number.'
    setErrors(missing)
    if (!courier || Object.keys(missing).length) return
    dispatch.mutate(
      { courierId: courier.id, awbNo: courier.awbNeeded ? awbNo : null, caseNos: d.cases.map((r) => r.caseNo) },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: `Docket ${d.docketNo} dispatched.` })
          onClose()
        },
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
          if (errorCode(err) === 'DISPATCH_BLOCKED') void queryClient.invalidateQueries({ queryKey: enquiryKeys.dispatchCheck(c.caseNo) })
        },
      },
    )
  }

  const v = check.data?.vendor
  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog dispatch-dialog" role="dialog" aria-modal="true" aria-labelledby="dispatch-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="dispatch-title">
          Dispatch docket {d.docketNo}
        </h2>

        {check.isPending ? (
          <p className="muted">Checking…</p>
        ) : check.isError ? (
          <div className="alert alert-bad">{errorText(check.error)}</div>
        ) : (
          <>
            {v && (
              <p className="muted small" style={{ margin: 0 }}>
                To <strong>{v.name}</strong>, {v.city} · {v.email}
              </p>
            )}
            <div className="dispatch-files">
              {d.cases.map((r) => (
                <div key={r.caseNo} className="kv">
                  <span>
                    <span className="mono">{r.caseNo}</span>
                    {r.family && ` · ${r.family}`}
                  </span>
                  <span>
                    {passports(r.passports, r.oldPassports)} ·{' '}
                    {r.invoiceNo ? <span className="mono">{r.invoiceNo}</span> : <span className="dispatch-no-invoice">no invoice</span>}
                  </span>
                </div>
              ))}
            </div>

            {blockers.length > 0 ? (
              <div className="alert alert-warn">
                <strong>Not ready yet.</strong>
                <ul className="missing-list">
                  {blockers.map((b) => (
                    <li key={b.kind}>
                      {b.label}
                      {b.items.length > 0 && <> {b.items.join(', ')}.</>} {fixLink(b.kind)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <label className="field">
                  <span className="lbl">Courier</span>
                  <select
                    className="select"
                    value={courierId}
                    onChange={(e) => setCourierId(e.target.value)}
                    disabled={couriers.isPending || dispatch.isPending}
                    autoFocus
                  >
                    <option value="">{couriers.isPending ? 'Loading…' : 'Pick the courier…'}</option>
                    {options.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  {errors.courierId && <span className="field-error">{errors.courierId}</span>}
                </label>
                {courier?.awbNeeded && (
                  <label className="field">
                    <span className="lbl">Slip (AWB) number</span>
                    <input
                      className="input mono upper"
                      value={awbNo}
                      onChange={(e) => setAwbNo(e.target.value)}
                      disabled={dispatch.isPending}
                      inputMode="text"
                      autoComplete="off"
                    />
                    {errors.awbNo && <span className="field-error">{errors.awbNo}</span>}
                    <span className="hint">From the courier’s slip. Letters and digits; spaces are dropped.</span>
                  </label>
                )}
                {check.data && (
                  <p className="muted small" style={{ margin: 0 }}>
                    Every file moves to <strong>At vendor</strong>. Due back on each processor’s desk{' '}
                    <strong>{dayTime(check.data.confirmAt)}</strong>: Confirm vendor got it.
                  </p>
                )}
              </>
            )}
          </>
        )}

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || dispatch.isPending} onClick={submit}>
            {dispatch.isPending ? 'Dispatching…' : `Dispatch ${d.cases.length} ${d.cases.length === 1 ? 'file' : 'files'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
