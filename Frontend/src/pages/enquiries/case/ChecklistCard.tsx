import { useRef, useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { formatDateTime, formatMonthYear } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { MemberFormDrawer } from '../../clients/MemberFormDrawer'
import { useClient, useClientOptions } from '../../clients/queries'
import { SCAN_ACCEPT, scanProblem, scanType } from '../../clients/scanFiles'
import { useCheckCaseDocument, useLinkTraveller, useOpenCaseScan, useSaveCaseScan, useUpdateCaseDocument } from '../queries'
import type { CaseDocument, CaseTraveller, ReceivedAs, VisaCase } from '../types'
import { dayMonth, RECEIVED_AS_LABEL, REQUIREMENT_LABEL, travellerTab, xeroxForOriginal } from './labels'
import { NeedsReplacingDialog } from './NeedsReplacingDialog'

/** The steps where the checklist can still change; after maturity it is the processor's (0006 Decision 8). */
const COLLECTING = ['ENQUIRY', 'DOCUMENTS']

/** "In · 3 Oct, 4:12 pm · by Aarti": the receipt, shown on hover once the Check column takes the Status column's place. */
function receiptTitle(doc: CaseDocument) {
  if (doc.status !== 'RECEIVED' && doc.status !== 'MADE') return undefined
  const by = doc.receivedBy ? ` · by ${doc.receivedBy.name}` : ''
  return `${doc.status === 'MADE' ? 'Made' : 'In'} · ${formatDateTime(doc.receivedAt)}${by}`
}

/** "Checked · 12 Oct, 4:12 pm · by Neha Joshi" */
function checkTitle(doc: CaseDocument) {
  if (!doc.check) return undefined
  const what = doc.check === 'CHECKED' ? 'Checked' : 'Flagged'
  return `${what} · ${formatDateTime(doc.checkedAt)}${doc.checkedBy ? ` · by ${doc.checkedBy.name}` : ''}`
}

/** The processor's check (Step 3): To check / Checked / Needs replacing · reason. */
function CheckChip({ doc }: { doc: CaseDocument }) {
  if (doc.status === 'NOT_NEEDED') return <span className="muted">—</span>
  if (doc.check === 'CHECKED') return <span className="chip chip-ok chip-sm">Checked</span>
  if (doc.check === 'NEEDS_REPLACING') {
    return <span className="chip chip-bad chip-sm">Needs replacing · {doc.checkReason?.name ?? '—'}</span>
  }
  return <span className="chip chip-warn chip-sm">To check</span>
}

/** Pending / "In · 3 Oct, 4:12 pm" / "Made · …" / Not needed. */
function StatusChip({ doc }: { doc: CaseDocument }) {
  switch (doc.status) {
    case 'RECEIVED':
      return <span className="chip chip-ok chip-sm">In · {formatDateTime(doc.receivedAt)}</span>
    case 'MADE':
      return <span className="chip chip-ok chip-sm">Made · {formatDateTime(doc.receivedAt)}</span>
    case 'NOT_NEEDED':
      return <span className="chip chip-muted chip-sm">Not needed</span>
    default:
      return <span className="chip chip-warn chip-sm">Pending</span>
  }
}

/**
 * The per-traveller checklist (demo screen 07, §10.4): copied at intake from Masters, ticked as each paper is scanned in
 * the office (0006 Decisions 2 and 3). The case's owner, its HOD and the Head can change it while documents are collected.
 * After maturity the processor checks each paper again: Checked, or Needs replacing with a reason (0007 Decision 3).
 * The Check column then takes the Status column's place, since every paper is in by then.
 */
export function ChecklistCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const [selected, setSelected] = useState(c.travellers[0]?.id)
  const traveller = c.travellers.find((t) => t.id === selected) ?? c.travellers[0]
  if (!traveller) return null
  const canAct = !!me && c.status === 'OPEN' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const editable = canAct && COLLECTING.includes(c.stage.code)
  const showChecks = !!c.maturedAt
  const canCheck = canAct && c.stage.code === 'FILE_PREPARATION'
  const who = traveller.name ?? traveller.label

  return (
    <section className="card pad">
      <div className="card-head">
        <div>
          <h2 className="h2">Document checklist</h2>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {!showChecks
              ? 'Tick each paper as it is scanned at the office — original or xerox, or On file when the client’s copy is already kept.'
              : canCheck
                ? 'Check each paper again before the file is made. Flag a bad one with what’s wrong.'
                : 'The processor checks each paper again before the file is made.'}
          </p>
        </div>
        <div className="checklist-count">
          <strong>
            {showChecks ? traveller.checked : traveller.done} / {showChecks ? traveller.done : traveller.need}
          </strong>
          <div className="muted small">{showChecks ? `checked for ${who}` : `for ${who}`}</div>
          {showChecks && traveller.needsReplacing > 0 && (
            <div className="small check-flagged">{traveller.needsReplacing} to replace</div>
          )}
        </div>
      </div>

      {c.stage.code === 'ENQUIRY' && c.status === 'OPEN' && (
        <div className="alert alert-info step-note" role="status">
          This case is still at <strong>Step 1 (Enquiry)</strong>. It moves to Step 2 when you start collecting documents: name a
          traveller, tick a paper, or press “Start collecting documents”.
        </div>
      )}

      {c.travellers.length > 1 && (
        <div className="kind-toggle traveller-tabs" role="tablist" aria-label="Traveller">
          {c.travellers.map((t) => {
            const label = travellerTab(t)
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === traveller.id}
                className={t.id === traveller.id ? 'on' : ''}
                onClick={() => setSelected(t.id)}
              >
                {label.name}
                {label.detail && <span> · {label.detail}</span>}
                {showChecks && t.needsReplacing > 0 && (
                  <b className="chip chip-bad chip-sm tab-flag">
                    {t.needsReplacing}
                    <span className="sr-only"> to replace</span>
                  </b>
                )}
              </button>
            )
          })}
        </div>
      )}

      <TravellerIdentity key={traveller.id} visaCase={c} traveller={traveller} editable={editable} />

      <div
        className={`checklist${editable ? ' editable' : ''}${showChecks ? ' checking' : ''}`}
        role="table"
        aria-label={`Documents for ${who}`}
      >
        <div className="checklist-row head" role="row">
          <span role="columnheader" aria-label="Done" />
          <span role="columnheader">Document</span>
          <span role="columnheader">We need</span>
          <span role="columnheader">Came in as</span>
          <span role="columnheader">{showChecks ? 'Check' : 'Status'}</span>
          {editable && <span role="columnheader" aria-label="Actions" />}
        </div>
        {traveller.documents.map((d) =>
          showChecks ? (
            <CheckRow key={d.id} caseNo={c.caseNo} doc={d} canCheck={canCheck} travellerName={who} />
          ) : (
            <DocumentRow
              key={d.id}
              caseNo={c.caseNo}
              doc={d}
              editable={editable}
              named={!!traveller.member}
              travellerName={who}
              scanMaxMb={c.scanMaxMb}
            />
          ),
        )}
      </div>

      <p className="checklist-foot">
        Clients don’t upload anything — papers are scanned here by the follow-up desk. “Save scan” keeps a paper in the
        client’s documents for the next trip. The checklist comes from Masters → {c.country.label} · {c.visaType.name}.
      </p>
    </section>
  )
}

/**
 * Who this traveller is. "Adult 1" is a placeholder from intake; naming it links the client's family member, which
 * brings the passport and the consent. New people are added to the family on the spot.
 */
function TravellerIdentity({ visaCase: c, traveller, editable }: { visaCase: VisaCase; traveller: CaseTraveller; editable: boolean }) {
  const [changing, setChanging] = useState(false)
  const m = traveller.member

  if (m && !changing) {
    const passport =
      m.passportStatus === 'EXPIRED'
        ? { text: `Passport expired ${formatMonthYear(m.passportExpiry)}`, tone: 'chip-bad' }
        : m.passportStatus === 'RENEW_SOON'
          ? { text: `Passport ${formatMonthYear(m.passportExpiry)} · renew soon`, tone: 'chip-warn' }
          : m.passportStatus === 'VALID'
            ? { text: `Passport till ${formatMonthYear(m.passportExpiry)}`, tone: 'chip-ok' }
            : { text: 'No passport on file', tone: 'chip-muted' }
    return (
      <div className="traveller-identity">
        <div>
          <strong>{m.name}</strong>
          <span className="muted small">
            {' '}
            · {[m.relation?.name, m.age != null ? `${m.age}` : null].filter(Boolean).join(', ') || (traveller.isChild ? 'child' : 'adult')}
          </span>
        </div>
        <span className={`chip chip-sm ${passport.tone}`}>{passport.text}</span>
        {editable && (
          <button type="button" className="btn-link small" onClick={() => setChanging(true)}>
            Change
          </button>
        )}
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="alert alert-warn" role="status">
        “{traveller.label}” isn’t named yet: the enquiry form only asks how many people travel.
      </div>
    )
  }
  return <TravellerPicker visaCase={c} traveller={traveller} onDone={() => setChanging(false)} canCancel={!!m} />
}

function TravellerPicker({
  visaCase: c,
  traveller,
  onDone,
  canCancel,
}: {
  visaCase: VisaCase
  traveller: CaseTraveller
  onDone: () => void
  canCancel: boolean
}) {
  const toast = useToast()
  const client = useClient(c.client.id)
  const options = useClientOptions()
  const link = useLinkTraveller(c.caseNo)
  // A passport that runs out too soon after the trip: check, then name them anyway.
  const guard = useWarningGuard()
  const [adding, setAdding] = useState(false)

  // Someone already on this case can't be a second traveller.
  const taken = new Set(c.travellers.filter((t) => t.id !== traveller.id && t.member).map((t) => t.member!.id))
  const members = (client.data?.members ?? []).filter((m) => !taken.has(m.id))

  const pick = (memberId: string, confirmWarnings = false): void =>
    link.mutate(
      { travellerId: traveller.id, memberId, ...(confirmWarnings ? { confirmWarnings } : {}) },
      {
        onSuccess: onDone,
        onError: (err) => {
          if (guard.intercept(err, () => pick(memberId, true))) return
          toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t name this traveller. Please try again.' })
        },
      },
    )

  return (
    <div className="traveller-picker">
      <label className="field" style={{ flex: 1, minWidth: 220 }}>
        <span className="lbl">Who is “{traveller.label}”?</span>
        <select
          className="select"
          value=""
          disabled={client.isPending || link.isPending}
          onChange={(e) => e.target.value && pick(e.target.value)}
        >
          <option value="">{client.isPending ? 'Loading the family…' : members.length ? 'Pick from the family…' : 'No one on the family list yet'}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.relation ? ` · ${m.relation.name}` : ''}
              {m.age != null ? `, ${m.age}` : ''}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" disabled={!options.data || link.isPending} onClick={() => setAdding(true)}>
        + Add person
      </button>
      {canCancel && (
        <button type="button" className="btn-link" onClick={onDone}>
          Cancel
        </button>
      )}
      {adding && options.data && (
        <MemberFormDrawer
          clientId={c.client.id}
          member={null}
          options={options.data}
          onClose={() => setAdding(false)}
          onSaved={(saved) => pick(saved.id)}
        />
      )}
      {guard.modal}
    </div>
  )
}

/** "Came in as" for a paper: the default follows what we need. On file is never the default (0016 Decision 5). */
const defaultReceivedAs = (doc: CaseDocument): ReceivedAs => (doc.requirement === 'ORIGINAL' ? 'ORIGINAL' : 'XEROX')

/** The "Came in as" choices: On file too for a paper that may be a xerox and has a copy in the client's vault. */
const receivedAsChoices = (doc: CaseDocument): ReceivedAs[] =>
  doc.requirement === 'XEROX_OK' && (doc.onFile || doc.receivedAs === 'ON_FILE') ? ['ORIGINAL', 'XEROX', 'ON_FILE'] : ['ORIGINAL', 'XEROX']

/**
 * The paper's copy in the client's document vault (0016 Decision 5): "On file · saved 12 Mar · Open", or for a paper
 * ticked On file the copy it came from. "Save scan" keeps this paper there for the next trip (named travellers only).
 * "Scan not saved" warns while one is still wanted (Decision 7); it never stops anything.
 */
function VaultLine({
  caseNo,
  doc: d,
  canSave,
  travellerName,
  maxMb,
}: {
  caseNo: string
  doc: CaseDocument
  canSave: boolean
  travellerName: string
  maxMb: number
}) {
  const toast = useToast()
  const open = useOpenCaseScan(caseNo)
  const save = useSaveCaseScan(caseNo)
  const picker = useRef<HTMLInputElement>(null)
  const from = d.receivedAs === 'ON_FILE' ? d.fromScan : null
  const copy = from ?? d.onFile
  if (!copy && !canSave) return null

  const send = (picked: File | undefined) => {
    if (picker.current) picker.current.value = ''
    if (!picked) return
    const type = scanType(picked)
    const problem = scanProblem(picked, maxMb)
    if (problem || !type) {
      toast({ tone: 'bad', message: problem ?? 'Pick a PDF, JPEG or PNG.' })
      return
    }
    save.mutate(
      { documentId: d.id, file: picked, type },
      {
        onSuccess: () => toast({ tone: 'ok', message: `${d.name} saved to ${travellerName}’s documents.` }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save the scan. Please try again.' }),
      },
    )
  }

  return (
    <div className="doc-note doc-vault">
      {copy && (
        <>
          {from ? `From the copy of ${dayMonth(from.uploadedAt)}` : `On file · saved ${dayMonth(copy.uploadedAt)}`} ·{' '}
          <button type="button" className="btn-link" onClick={() => open(d.id)}>
            Open
          </button>
        </>
      )}
      {canSave && (
        <>
          {copy && ' · '}
          {d.noScan && (
            <>
              <span className="doc-no-scan">Scan not saved</span> ·{' '}
            </>
          )}
          <button type="button" className="btn-link" disabled={save.isPending} onClick={() => picker.current?.click()}>
            {save.isPending ? 'Saving…' : copy ? 'Save a newer scan' : 'Save scan'}
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            accept={SCAN_ACCEPT}
            aria-label={`Scan of ${d.name}`}
            onChange={(e) => send(e.target.files?.[0])}
          />
        </>
      )}
    </div>
  )
}

function DocumentRow({
  caseNo,
  doc: d,
  editable,
  named,
  travellerName,
  scanMaxMb,
}: {
  caseNo: string
  doc: CaseDocument
  editable: boolean
  /** The traveller is linked to a family member: copies on file are kept per person. */
  named: boolean
  travellerName: string
  scanMaxMb: number
}) {
  const toast = useToast()
  const update = useUpdateCaseDocument(caseNo)
  const arranged = d.requirement === 'ARRANGED_BY_US'
  const done = d.status === 'RECEIVED' || d.status === 'MADE'
  const choices = receivedAsChoices(d)
  const canSave = editable && named && !arranged && d.status !== 'NOT_NEEDED'

  const set = (status: CaseDocument['status'], receivedAs: ReceivedAs | null = null) =>
    update.mutate(
      { documentId: d.id, status, receivedAs },
      { onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save that tick. Please try again.' }) },
    )
  const toggle = () => {
    if (done) set('PENDING')
    else if (arranged) set('MADE')
    else set('RECEIVED', defaultReceivedAs(d))
  }

  const busy = update.isPending
  const canTick = editable && d.status !== 'NOT_NEEDED'

  return (
    <div className={`checklist-row${d.status === 'NOT_NEEDED' ? ' off' : ''}${busy ? ' busy' : ''}`} role="row">
      <span role="cell">
        {canTick ? (
          <button
            type="button"
            className={`tick${done ? ' on' : ''}`}
            aria-pressed={done}
            aria-label={done ? `Untick ${d.name}` : `Tick ${d.name}`}
            disabled={busy}
            onClick={toggle}
          >
            {done ? '✓' : ''}
          </button>
        ) : (
          <span className={`tick${done ? ' on' : ''}`} aria-label={done ? 'In' : 'Not in yet'}>
            {done ? '✓' : ''}
          </span>
        )}
      </span>
      <span role="cell">
        <span className="doc-name">
          {d.name}
          {d.quantity > 1 && ` (${d.quantity})`}
        </span>
        {(d.detail || d.note) && <div className="doc-note">{[d.detail, d.note].filter(Boolean).join(' · ')}</div>}
        {xeroxForOriginal(d) && (
          <div style={{ marginTop: 4 }}>
            <span className="chip chip-sm chip-warn">Original needed · came as a xerox</span>
          </div>
        )}
        <VaultLine caseNo={caseNo} doc={d} canSave={canSave} travellerName={travellerName} maxMb={scanMaxMb} />
      </span>
      <span role="cell" className="small">
        {REQUIREMENT_LABEL[d.requirement]}
      </span>
      <span role="cell" className="small">
        {arranged ? (
          <span className="muted">{d.status === 'MADE' ? 'Made by us' : '—'}</span>
        ) : editable && d.status !== 'NOT_NEEDED' ? (
          <span className={`seg-btn${choices.length > 2 ? ' seg-three' : ''}`} role="radiogroup" aria-label={`${d.name} came in as`}>
            {choices.map((as) => (
              <button
                key={as}
                type="button"
                role="radio"
                aria-checked={d.receivedAs === as}
                className={d.receivedAs === as ? 'on' : ''}
                disabled={busy}
                // On file again picks up a newer copy saved since the paper was ticked.
                onClick={() => (d.receivedAs !== as || (as === 'ON_FILE' && d.fromScan?.id !== d.onFile?.id)) && set('RECEIVED', as)}
              >
                {RECEIVED_AS_LABEL[as]}
              </button>
            ))}
          </span>
        ) : d.receivedAs ? (
          RECEIVED_AS_LABEL[d.receivedAs]
        ) : (
          '—'
        )}
      </span>
      <span role="cell" title={d.receivedBy ? `By ${d.receivedBy.name}` : undefined}>
        <StatusChip doc={d} />
      </span>
      {editable && (
        <span role="cell" className="row-action">
          <button
            type="button"
            className="btn-mini"
            disabled={busy}
            aria-label={d.status === 'NOT_NEEDED' ? `Mark ${d.name} as needed` : `Mark ${d.name} as not needed`}
            onClick={() => set(d.status === 'NOT_NEEDED' ? 'PENDING' : 'NOT_NEEDED')}
          >
            {d.status === 'NOT_NEEDED' ? 'Needed' : 'Not needed'}
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * A paper after maturity (0007 Decision 3). Step 2's receipt is read-only here, with its time on hover. The processor
 * (or the HOD or the Head) marks it Checked, pressing again to undo, or flags it Needs replacing with a reason.
 */
function CheckRow({
  caseNo,
  doc: d,
  canCheck,
  travellerName,
}: {
  caseNo: string
  doc: CaseDocument
  canCheck: boolean
  travellerName: string
}) {
  const toast = useToast()
  const check = useCheckCaseDocument(caseNo)
  const [flagging, setFlagging] = useState(false)
  const arranged = d.requirement === 'ARRANGED_BY_US'
  const done = d.status === 'RECEIVED' || d.status === 'MADE'
  const checked = d.check === 'CHECKED'
  const needs = d.check === 'NEEDS_REPLACING'
  const busy = check.isPending

  const toggleChecked = () =>
    check.mutate(
      { documentId: d.id, check: checked ? null : 'CHECKED' },
      { onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save that check. Please try again.' }) },
    )

  return (
    <>
      <div className={`checklist-row${d.status === 'NOT_NEEDED' ? ' off' : ''}${busy ? ' busy' : ''}`} role="row">
        <span role="cell">
          <span className={`tick${done ? ' on' : ''}`} aria-label={done ? 'In' : 'Not needed'}>
            {done ? '✓' : ''}
          </span>
        </span>
        <span role="cell">
          <span className="doc-name">
            {d.name}
            {d.quantity > 1 && ` (${d.quantity})`}
          </span>
          {(d.detail || d.note) && <div className="doc-note">{[d.detail, d.note].filter(Boolean).join(' · ')}</div>}
          {xeroxForOriginal(d) && (
            <div style={{ marginTop: 4 }}>
              <span className="chip chip-sm chip-warn">Original needed · came as a xerox</span>
            </div>
          )}
          {/* The processor prints an On file paper from its copy (0016 Decision 5). */}
          {d.receivedAs === 'ON_FILE' && <VaultLine caseNo={caseNo} doc={d} canSave={false} travellerName={travellerName} maxMb={0} />}
        </span>
        <span role="cell" className="small">
          {REQUIREMENT_LABEL[d.requirement]}
        </span>
        <span role="cell" className="small" title={receiptTitle(d)}>
          {arranged ? (
            <span className="muted">{d.status === 'MADE' ? 'Made by us' : '—'}</span>
          ) : d.receivedAs ? (
            RECEIVED_AS_LABEL[d.receivedAs]
          ) : (
            <span className="muted">Not needed</span>
          )}
        </span>
        <span role="cell" className="check-cell" title={checkTitle(d)}>
          {canCheck && done ? (
            <>
              <span className="check-actions">
                <button
                  type="button"
                  className={`btn-mini${checked ? ' on-ok' : ''}`}
                  aria-pressed={checked}
                  aria-label={`Checked: ${d.name}`}
                  disabled={busy}
                  onClick={toggleChecked}
                >
                  ✓ Checked
                </button>
                <button
                  type="button"
                  className={`btn-mini${needs ? ' on-bad' : ''}`}
                  aria-pressed={needs}
                  aria-label={`Needs replacing: ${d.name}`}
                  disabled={busy}
                  onClick={() => setFlagging(true)}
                >
                  Needs replacing…
                </button>
              </span>
              {needs && <span className="check-flagged small">{d.checkReason?.name}</span>}
            </>
          ) : (
            <CheckChip doc={d} />
          )}
        </span>
      </div>
      {flagging && <NeedsReplacingDialog caseNo={caseNo} doc={d} travellerName={travellerName} onClose={() => setFlagging(false)} />}
    </>
  )
}
