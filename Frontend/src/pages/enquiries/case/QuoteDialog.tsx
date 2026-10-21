import { useState } from 'react'
import { RequiredMark } from '../../../components/FormField'
import { errorBody, errorText, isStale } from '../../../lib/apiErrors'
import { formatRupees, gstPaise, parseRupees, rupeesInput } from '../../../lib/money'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useSaveQuote } from '../queries'
import type { QuoteForm, SaveQuoteBody, VisaCase } from '../types'

/** ₹10,00,000 per amount: the backend's sanity limit (visa.schemas.ts MAX_AMOUNT_PAISE). */
const MAX_AMOUNT_PAISE = 100_000_000

interface LineDraft {
  form: QuoteForm
  lumpSum: string
  embassy: string
  vfs: string
  other: string
}

const ITEMS = [
  ['embassy', 'Embassy fee'],
  ['vfs', 'VFS fee'],
  ['other', 'Other'],
] as const

/** One typed amount: paise, or why it can't be used. Blank counts as 0 where `blankIsZero`. */
function amountOf(text: string, blankIsZero: boolean): { paise: number } | { error: string } {
  const paise = parseRupees(text)
  if (paise === null) return blankIsZero ? { paise: 0 } : { error: 'Enter the amount.' }
  if (paise === undefined) return { error: 'Use an amount like 3410 or 3410.50.' }
  if (paise > MAX_AMOUNT_PAISE) return { error: '₹10,00,000 at most.' }
  return { paise }
}

/** A traveller's line: its amounts in paise, or the first problem. Itemised blanks count as 0. */
function lineOf(travellerId: string, d: LineDraft): { line: SaveQuoteBody['lines'][number]; total: number } | { error: string } {
  if (d.form === 'LUMP_SUM') {
    const a = amountOf(d.lumpSum, false)
    return 'error' in a ? a : { line: { travellerId, form: 'LUMP_SUM', lumpSumPaise: a.paise }, total: a.paise }
  }
  const [embassy, vfs, other] = [amountOf(d.embassy, true), amountOf(d.vfs, true), amountOf(d.other, true)]
  for (const a of [embassy, vfs, other]) if ('error' in a) return a
  const [e, v, o] = [embassy, vfs, other].map((a) => ('paise' in a ? a.paise : 0)) as [number, number, number]
  return { line: { travellerId, form: 'ITEMISED', embassyFeePaise: e, vfsFeePaise: v, otherFeePaise: o }, total: e + v + o }
}

/**
 * The quote (docs/decisions/0009-visa-invoice.md Decision 2): per traveller a lump sum or itemised (embassy, VFS,
 * other), the processing speed, and Masti's service charge, the only part GST applies to. Saved whole; the invoice
 * will copy it, so this is the only place amounts are typed.
 */
export function QuoteDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveQuote(c.caseNo)
  const speeds = useMasterList('processing-speeds')
  const q = c.quote
  const rate = q?.gstRatePercent ?? c.gstRatePercent
  // The quote as it was when the dialog opened: a refetch while it's open mustn't let this save carry the new token
  // over a form filled in from the old quote.
  const [quoteSeen] = useState(q?.updatedAt ?? null)

  const [speedId, setSpeedId] = useState(q ? String(q.processingSpeed.id) : '')
  const [service, setService] = useState(q ? rupeesInput(q.serviceChargePaise) : '')
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      c.travellers.map((t) => {
        const l = q?.lines.find((x) => x.travellerId === t.id)
        return [
          t.id,
          {
            form: l?.form ?? 'LUMP_SUM',
            lumpSum: rupeesInput(l?.lumpSumPaise ?? null),
            embassy: rupeesInput(l?.embassyFeePaise ?? null),
            vfs: rupeesInput(l?.vfsFeePaise ?? null),
            other: rupeesInput(l?.otherFeePaise ?? null),
          },
        ]
      }),
    ),
  )
  const [tried, setTried] = useState(false)

  // The active speeds, plus the one already picked even if it was switched off since.
  const speedOptions = (speeds.data ?? []).filter((s) => s.isActive || s.id === q?.processingSpeed.id)
  // A new quote starts on the first active speed (Normal) once the list is in.
  const chosenSpeed = speedId || (q ? '' : String(speedOptions.find((s) => s.isActive)?.id ?? ''))

  const lines = c.travellers.map((t) => ({ traveller: t, result: lineOf(t.id, drafts[t.id]!) }))
  const serviceAmount = amountOf(service, true)
  const travellersPaise = lines.reduce((sum, l) => sum + ('total' in l.result ? l.result.total : 0), 0)
  const servicePaise = 'paise' in serviceAmount ? serviceAmount.paise : 0
  const tax = gstPaise(servicePaise, rate)
  const valid = !!chosenSpeed && 'paise' in serviceAmount && lines.every((l) => 'line' in l.result)

  const issues = errorBody(save.error)?.issues
  const serverMessage = issues ? (issues.lines?.[0] ?? issues.processingSpeedId?.[0] ?? issues.serviceChargePaise?.[0] ?? null) : errorText(save.error)

  const setDraft = (id: string, patch: Partial<LineDraft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }))

  const submit = () => {
    setTried(true)
    if (!valid) return
    save.mutate(
      {
        processingSpeedId: Number(chosenSpeed),
        serviceChargePaise: servicePaise,
        lines: lines.map((l) => ('line' in l.result ? l.result.line : null)).filter((l) => l !== null),
        updatedAt: quoteSeen,
      },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: 'Quote saved.' })
          onClose()
        },
        // Someone else saved the quote meanwhile: the case reloads with a warning, and this dialog's amounts are old.
        onError: (err) => {
          if (isStale(err)) onClose()
        },
      },
    )
  }

  const total = travellersPaise + servicePaise + tax

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog quote-dialog" role="dialog" aria-modal="true" aria-labelledby="quote-title" onClick={(e) => e.stopPropagation()}>
        <header className="quote-head">
          <div>
            <h2 className="h2" id="quote-title">
              {q ? 'Edit the quote' : 'Add a quote'}
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              <span className="mono">{c.caseNo}</span> · {c.travellers.length} {c.travellers.length === 1 ? 'traveller' : 'travellers'}. The invoice is
              built from this quote, so this is the only place amounts are typed.
            </p>
          </div>
          <button type="button" className="quote-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="quote-body">
          <section className="quote-section">
            <h3 className="lbl">Travellers</h3>
            <div className="quote-lines">
              {lines.map(({ traveller: t, result }, i) => {
                const d = drafts[t.id]!
                const name = t.member?.name ?? t.name
                return (
                  <div key={t.id} className="quote-line">
                    <div className="quote-line-head">
                      <span className="quote-line-no">{i + 1}</span>
                      <div className="quote-line-who">
                        <strong>{name ?? t.label}</strong>
                        {name && <span className="muted small">{t.label}</span>}
                      </div>
                      <div className="seg-btn" role="radiogroup" aria-label={`How ${t.label} is priced`}>
                        {(['LUMP_SUM', 'ITEMISED'] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            role="radio"
                            aria-checked={d.form === f}
                            className={d.form === f ? 'on' : ''}
                            onClick={() => setDraft(t.id, { form: f })}
                          >
                            {f === 'LUMP_SUM' ? 'Lump sum' : 'Itemised'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={`quote-amounts${d.form === 'ITEMISED' ? ' itemised' : ''}`}>
                      {d.form === 'LUMP_SUM' ? (
                        <MoneyInput label="Amount" required value={d.lumpSum} onChange={(v) => setDraft(t.id, { lumpSum: v })} placeholder="0.00" />
                      ) : (
                        ITEMS.map(([key, label]) => (
                          <MoneyInput key={key} label={label} value={d[key]} onChange={(v) => setDraft(t.id, { [key]: v })} placeholder="0" />
                        ))
                      )}
                      <div className="quote-line-total">
                        <span className="lbl">Total</span>
                        {'total' in result ? <strong>{formatRupees(result.total)}</strong> : <strong className="muted">—</strong>}
                      </div>
                    </div>
                    {tried && 'error' in result && <span className="field-error">{result.error}</span>}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="quote-section quote-case">
            <label className="field">
              <span className="lbl">Processing speed<RequiredMark /></span>
              <select className="select" value={chosenSpeed} onChange={(e) => setSpeedId(e.target.value)} disabled={speeds.isPending}>
                {!chosenSpeed && <option value="">{speeds.isPending ? 'Loading…' : 'Pick a speed…'}</option>}
                {speedOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive ? '' : ' (switched off)'}
                  </option>
                ))}
              </select>
              {/* An empty list (no speeds added, or all switched off) would otherwise look like a broken dropdown. */}
              {speeds.isSuccess && speedOptions.length === 0 ? (
                <span className="field-error">
                  No processing speeds yet. Ask the Visa HOD to add them in Settings → Masters → Lists → Processing speeds.
                </span>
              ) : (
                tried && !chosenSpeed && <span className="field-error">Pick the processing speed.</span>
              )}
            </label>
            <div className="field">
              <MoneyInput label="Masti’s service charge" value={service} onChange={setService} placeholder="0" />
              <span className="muted small">GST {rate}% applies to this part only.</span>
              {tried && 'error' in serviceAmount && <span className="field-error">{serviceAmount.error}</span>}
            </div>
          </section>

          {speeds.isError && <div className="alert alert-bad">{errorText(speeds.error)}</div>}
          {serverMessage && <div className="alert alert-bad">{serverMessage}</div>}
        </div>

        <footer className="quote-foot">
          <dl className="quote-sums">
            <div>
              <dt>Travellers</dt>
              <dd>{formatRupees(travellersPaise)}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{formatRupees(servicePaise)}</dd>
            </div>
            <div>
              <dt>GST {rate}%</dt>
              <dd>{formatRupees(tax)}</dd>
            </div>
            <div className="quote-grand">
              <dt>Total</dt>
              <dd>{formatRupees(total)}</dd>
            </div>
          </dl>
          <div className="quote-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={save.isPending || (tried && !valid)} onClick={submit}>
              {save.isPending ? 'Saving…' : 'Save quote'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** An amount in rupees, with ₹ inside the box and the figures right-aligned. */
function MoneyInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** Shows the red *: the lump sum must be filled in; a blank fee counts as 0. */
  required?: boolean
}) {
  return (
    <label className="field money-field">
      <span className="lbl">{label}{required && <RequiredMark />}</span>
      <span className="money-input">
        <span aria-hidden="true">₹</span>
        <input className="input" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  )
}
