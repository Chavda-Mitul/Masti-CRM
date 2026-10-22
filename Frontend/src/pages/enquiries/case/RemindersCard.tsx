import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useSetReminders } from '../queries'
import type { ReminderChannel, VisaCase } from '../types'
import { weekdayDay } from './labels'

const CHANNEL_LABEL: Record<ReminderChannel, string> = { WHATSAPP: 'WhatsApp', SMS: 'SMS' }

/**
 * "Reminders" (demo screen 07, 0006 amendment 19): pending-document reminders to the client every few days, as set in
 * Settings → Masters. The owner, the Visa HOD or the Head switches them off for one case. Postponing or cancelling is
 * only on the case header (amendment 20). They go on WhatsApp (message 3, 0021 amendment 3); SMS isn't built yet.
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
    </section>
  )
}

function ReminderLine({ visaCase: c }: { visaCase: VisaCase }) {
  const r = c.reminders
  if (!r.enabled) return <>Switched off for every case in Settings → Masters.</>
  if (!r.on) return <>Switched off for this case: the client gets no reminders.</>
  if (c.status === 'POSTPONED') return <>Paused while the case is postponed.</>
  // No next reminder: nothing the client brings is missing (what we arrange is never asked for).
  if (!r.nextAt) return <>Nothing the client brings is missing, so no reminder is due.</>
  const every = r.everyDays === 1 ? 'day' : `${r.everyDays} days`
  return (
    <>
      Every{' '}
      <strong>
        {every} at {r.sendAt}
      </strong>{' '}
      on {CHANNEL_LABEL[r.channel]}, listing only what’s still missing. Next: {weekdayDay(r.nextAt)}.
      {r.channel === 'SMS' && <span className="muted small reminders-note">SMS isn’t connected yet, so nothing is sent.</span>}
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
