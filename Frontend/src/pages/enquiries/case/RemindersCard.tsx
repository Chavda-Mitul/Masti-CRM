import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useSetReminders } from '../queries'
import type { ReminderChannel, VisaCase } from '../types'
import { weekdayDay } from './labels'
import { PostponeCancelDialog, type HoldKind } from './PostponeCancelDialog'

const CHANNEL_LABEL: Record<ReminderChannel, string> = { WHATSAPP: 'WhatsApp', SMS: 'SMS' }

/**
 * "Reminders" (demo screen 07, 0006 amendment 19): pending-document reminders to the client every few days, as set in
 * Settings → Masters. The owner, the Visa HOD or the Head switches them off for one case, and can postpone or cancel
 * the case from here. Nothing is sent until WhatsApp is connected.
 */
export function RemindersCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const canAct = !!me && canActOnCase(me, { department: c.department.code, owner: c.owner }) && c.status === 'OPEN'
  const r = c.reminders
  const active = r.on && r.enabled

  return (
    <section className="card pad reminders-card">
      <div className="card-head" style={{ paddingBottom: 8 }}>
        <h2 className="h2">Reminders</h2>
        {canAct ? <RemindersSwitch visaCase={c} /> : <span className={active ? 'chip chip-ok' : 'chip chip-muted'}>{active ? 'On' : 'Off'}</span>}
      </div>
      <p className="reminders-line">
        <ReminderLine visaCase={c} />
      </p>
      {canAct && <HoldReason visaCase={c} />}
    </section>
  )
}

function ReminderLine({ visaCase: c }: { visaCase: VisaCase }) {
  const r = c.reminders
  if (!r.enabled) return <>Switched off for every case in Settings → Masters.</>
  if (!r.on) return <>Switched off for this case: the client gets no reminders.</>
  if (c.status === 'POSTPONED') return <>Paused while the case is postponed.</>
  const pending = c.travellers.reduce((n, t) => n + t.pendingCount, 0)
  if (pending === 0) return <>Nothing is missing, so no reminder is due.</>
  const every = r.everyDays === 1 ? 'day' : `${r.everyDays} days`
  return (
    <>
      Every{' '}
      <strong>
        {every} at {r.sendAt}
      </strong>{' '}
      on {CHANNEL_LABEL[r.channel]}, listing only what’s still missing.{r.nextAt && ` Next: ${weekdayDay(r.nextAt)}.`}
      <span className="muted small reminders-note">Sending starts once WhatsApp is connected.</span>
    </>
  )
}

/** On | Off, like "How the documents reach us". */
function RemindersSwitch({ visaCase: c }: { visaCase: VisaCase }) {
  const toast = useToast()
  const set = useSetReminders(c.caseNo)
  const change = (on: boolean) => {
    if (on === c.reminders.on) return
    set.mutate(
      { on },
      {
        onSuccess: () => toast({ tone: 'ok', message: on ? 'Reminders on for this case.' : 'Reminders off for this case.' }),
        onError: (err) => {
          const message = errorText(err)
          if (message) toast({ tone: 'bad', message })
        },
      },
    )
  }
  return (
    <div className="seg-btn" role="radiogroup" aria-label="Reminders for this case">
      {[true, false].map((on) => (
        <button key={String(on)} type="button" role="radio" aria-checked={c.reminders.on === on} className={c.reminders.on === on ? 'on' : ''} disabled={set.isPending} onClick={() => change(on)}>
          {on ? 'On' : 'Off'}
        </button>
      ))}
    </div>
  )
}

/** "Postpone or cancel — reason": picking one opens the Postpone or cancel dialog with it already chosen. */
function HoldReason({ visaCase: c }: { visaCase: VisaCase }) {
  const reasons = useMasterList('enquiry-reasons')
  const [picked, setPicked] = useState<{ kind: HoldKind; reasonId: string } | null>(null)
  // Only the reasons tagged with the case's department (0018).
  const options = (reasons.data ?? []).filter((r) => r.isActive && r.departments.includes(c.department.code))
  const group = (kind: HoldKind) => options.filter((r) => r.kind === kind)

  return (
    <>
      <label className="field">
        <span className="lbl">Postpone or cancel — reason</span>
        <select
          className="select"
          value=""
          disabled={reasons.isPending}
          onChange={(e) => {
            const reason = options.find((r) => String(r.id) === e.target.value)
            if (reason) setPicked({ kind: reason.kind, reasonId: String(reason.id) })
          }}
        >
          <option value="">{reasons.isPending ? 'Loading…' : 'Pick a reason…'}</option>
          {(['POSTPONE', 'CANCEL'] as const).map((kind) =>
            group(kind).length > 0 ? (
              <optgroup key={kind} label={kind === 'POSTPONE' ? 'Postpone' : 'Cancel the case'}>
                {group(kind).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ) : null,
          )}
        </select>
        <span className="hint">Fixed reasons only — no free text anywhere.</span>
      </label>
      {picked && (
        <PostponeCancelDialog visaCase={c} initialKind={picked.kind} initialReasonId={picked.reasonId} onClose={() => setPicked(null)} />
      )}
    </>
  )
}
