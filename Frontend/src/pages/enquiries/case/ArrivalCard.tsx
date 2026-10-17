import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useUpdateVisaCase } from '../queries'
import type { DocumentArrival, VisaCase } from '../types'
import { bookletsText } from './labels'
import { PickupJob } from './PickupJob'

const ARRIVAL_LABEL: Record<DocumentArrival, string> = { CLIENT_BRINGS: 'Client brings them', COLLECTION_BOY: 'Send collection boy' }

/**
 * "How the documents reach us" (demo screen 07, 0006 Decision 4). The case's owner, its HOD or the Head can change it
 * while documents are collected, and book the collection boy for "Send collection boy" (0015 phase 1).
 */
export function ArrivalCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const editable =
    !!me &&
    c.status === 'OPEN' &&
    (c.stage.code === 'ENQUIRY' || c.stage.code === 'DOCUMENTS') &&
    canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad">
      <h2 className="h2" style={{ marginBottom: 8 }}>
        How the documents reach us
      </h2>
      {editable ? <ArrivalForm visaCase={c} /> : <ArrivalView visaCase={c} />}
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        The booklet count is checked again at handover.
      </p>
    </section>
  )
}

function ArrivalView({ visaCase: c }: { visaCase: VisaCase }) {
  return (
    <>
      <div className="kv">
        <span>How</span>
        <strong>{c.arrival ? ARRIVAL_LABEL[c.arrival] : <span className="muted">Not set yet</span>}</strong>
      </div>
      {(c.arrival === 'COLLECTION_BOY' || c.fieldJobs.some((j) => j.kind === 'PICKUP')) && <PickupJob visaCase={c} canBook={false} />}
      <div className="kv">
        <span>Booklets received</span>
        <strong>{bookletsText(c.booklets)}</strong>
      </div>
    </>
  )
}

/** A number box's text → a count, or null when blank. */
const toCount = (text: string) => (text.trim() === '' ? null : Number(text))

function ArrivalForm({ visaCase: c }: { visaCase: VisaCase }) {
  const toast = useToast()
  const update = useUpdateVisaCase(c.caseNo)
  const [current, setCurrent] = useState(c.booklets.current?.toString() ?? '')
  const [old, setOld] = useState(c.booklets.old?.toString() ?? '')
  const dirty = toCount(current) !== c.booklets.current || toCount(old) !== c.booklets.old
  const valid = [current, old].every((v) => v.trim() === '' || (/^\d+$/.test(v) && Number(v) <= 50))

  const onError = (err: unknown) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save. Please try again.' })
  const saveBooklets = () =>
    update.mutate(
      { bookletsCurrent: toCount(current), bookletsOld: toCount(old) },
      { onSuccess: () => toast({ tone: 'ok', message: 'Booklets saved.' }), onError },
    )

  return (
    <>
      <div className="seg-btn arrival-toggle" role="radiogroup" aria-label="How the documents reach us">
        {(['CLIENT_BRINGS', 'COLLECTION_BOY'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={c.arrival === a}
            className={c.arrival === a ? 'on' : ''}
            disabled={update.isPending}
            onClick={() => c.arrival !== a && update.mutate({ arrival: a }, { onError })}
          >
            {ARRIVAL_LABEL[a]}
          </button>
        ))}
      </div>
      {c.arrival === 'COLLECTION_BOY' && <PickupJob visaCase={c} canBook />}

      <div className="booklets-row">
        <span className="lbl">Booklets received</span>
        <label>
          <input
            className="input booklet-input"
            inputMode="numeric"
            value={current}
            onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 2))}
            aria-label="Current passports"
            placeholder="0"
          />
          current
        </label>
        <span aria-hidden="true">+</span>
        <label>
          <input
            className="input booklet-input"
            inputMode="numeric"
            value={old}
            onChange={(e) => setOld(e.target.value.replace(/\D/g, '').slice(0, 2))}
            aria-label="Old passports"
            placeholder="0"
          />
          old
        </label>
        <button type="button" className="btn btn-sm" disabled={!dirty || !valid || update.isPending} onClick={saveBooklets}>
          Save
        </button>
      </div>
      {!valid && <span className="field-error">Up to 50 each.</span>}
    </>
  )
}
