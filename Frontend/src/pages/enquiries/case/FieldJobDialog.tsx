import { useState } from 'react'
import { Link } from 'react-router'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { istParts, istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useBookFieldJob, useChangeFieldJob, useFieldStaff } from '../queries'
import type { FieldJob, VisaCase } from '../types'
import { bookletsText, longDate } from './labels'
import { OpenDayCalendar } from './OpenDayCalendar'

/** How the dialog talks about each kind of job (0015) ⚠️. */
const WORDING = {
  PICKUP: { book: 'Book the collection boy', change: 'Change the pickup', who: 'Pick the collection boy…', day: 'Pickup day', where: 'Pick up from', done: 'Collection boy booked', changed: 'Pickup changed.' },
  DELIVERY: { book: 'Book the delivery boy', change: 'Change the delivery', who: 'Pick the delivery boy…', day: 'Delivery day', where: 'Deliver to', done: 'Delivery boy booked', changed: 'Delivery changed.' },
} as const

/**
 * "Book the collection boy" (docs/decisions/0015-field-staff-app.md, phase 1) or "Book the delivery boy" (phase 2), or
 * "Change" on a booked one: who goes (the field staff), an open office day, a time slot from the list (on today, the
 * ones already over can't be picked), and where (the client's address, correctable, and their Google Maps link if they
 * shared one). The client's email must be on file: the one-time code they give the boy goes there.
 */
export function FieldJobDialog({
  visaCase: c,
  job,
  kind = job?.kind ?? 'PICKUP',
  onClose,
}: {
  visaCase: VisaCase
  job?: FieldJob
  kind?: FieldJob['kind']
  onClose: () => void
}) {
  const words = WORDING[kind]
  const toast = useToast()
  const staff = useFieldStaff()
  const slots = useMasterList('field-slots')
  const book = useBookFieldJob(c.caseNo)
  const change = useChangeFieldJob(c.caseNo)
  const save = job ? change : book
  const [assigneeId, setAssigneeId] = useState(job?.assignee.id ?? '')
  const [day, setDay] = useState<string | null>(job?.day ?? null)
  const [slotId, setSlotId] = useState<number | null>(job?.slot.id ?? null)
  const [address, setAddress] = useState(job?.address ?? c.client.address)
  const [mapLink, setMapLink] = useState(job?.mapLink ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  // The case as it was when the dialog opened: the page refetches while it's open (another window, a colleague), and
  // the save must not carry the new updatedAt over a form filled in from the old values.
  const [openedAt] = useState(c.updatedAt)
  const today = istToday()
  // The time in India when the dialog opened: on today, slots that have ended can't be picked.
  const [now] = useState(() => istParts(new Date().toISOString()).time)
  // The job's own slot stays on the list if it was switched off since.
  const options = (slots.data ?? []).filter((s) => s.isActive || s.id === job?.slot.id)
  const over = (endsAt: string) => day === today && endsAt <= now
  const noEmail = !c.client.email
  const fixed = (field: string) => setErrors((all) => (all[field] ? { ...all, [field]: '' } : all))

  const press = () => {
    const missing: Record<string, string> = {}
    if (!assigneeId) missing.assigneeId = 'Pick who goes.'
    if (!day) missing.day = 'Pick the day.'
    if (!slotId) missing.slotId = 'Pick the time slot.'
    if (!address.trim()) missing.address = 'Enter the address.'
    setErrors(missing)
    if (!day || !slotId || Object.keys(missing).length) return
    const body = { assigneeId, day, slotId, address, mapLink: mapLink.trim() || null, updatedAt: openedAt }
    const done = {
      onSuccess: () => {
        toast({ tone: 'ok', message: job ? words.changed : `${words.done} for ${longDate(day)}.` })
        onClose()
      },
      onError: (err: unknown) => {
        const issues = errorBody(err)?.issues ?? {}
        setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
      },
    }
    if (job) change.mutate({ ...body, jobId: job.id }, done)
    else book.mutate({ ...body, kind }, done)
  }
  const message = errorBody(save.error)?.issues ? null : errorText(save.error)

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog submission-dialog" role="dialog" aria-modal="true" aria-labelledby="field-job-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="field-job-title">
          {job ? words.change : words.book}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {kind === 'PICKUP' ? `He collects the documents from ${c.client.name}.` : `He takes the passports to ${c.client.name}.`} At the door
          the client gives him a one-time code from their email.
        </p>
        {kind === 'DELIVERY' && c.passportsReceived && (
          <div className="kv">
            <span>He hands over</span>
            <strong>{bookletsText(c.passportsReceived.booklets)}</strong>
          </div>
        )}
        {noEmail && (
          <div className="alert alert-bad">
            Add {c.client.name}’s email first: the one-time code they give the boy goes there.{' '}
            <Link to={`/clients/${c.client.id}`}>Open the client</Link>
          </div>
        )}

        <label className="field">
          <span className="lbl">Who goes</span>
          <select
            className="select"
            value={assigneeId}
            onChange={(e) => {
              setAssigneeId(e.target.value)
              fixed('assigneeId')
            }}
            disabled={save.isPending}
          >
            <option value="">{staff.isPending ? 'Loading…' : words.who}</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.mobile}
              </option>
            ))}
          </select>
          {staff.data?.length === 0 && <span className="hint">No field staff yet: the Head adds them on the Users page.</span>}
          {errors.assigneeId && <span className="field-error">{errors.assigneeId}</span>}
        </label>

        <div className="field">
          <span className="lbl">Day</span>
          <span className="hint" style={{ marginTop: 0 }}>
            Sundays and our office’s holidays can’t be picked.
          </span>
          <OpenDayCalendar
            target={{ office: true }}
            label={words.day}
            value={day}
            onChange={(d) => {
              setDay(d)
              fixed('day')
            }}
            allowToday
            disabled={save.isPending}
          />
          {errors.day && <span className="field-error">{errors.day}</span>}
        </div>

        <label className="field">
          <span className="lbl">Time slot</span>
          <select
            className="select"
            value={slotId ?? ''}
            onChange={(e) => {
              setSlotId(e.target.value ? Number(e.target.value) : null)
              fixed('slotId')
            }}
            disabled={save.isPending}
          >
            <option value="">Pick the slot…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id} disabled={over(s.endsAt)}>
                {s.name}
                {over(s.endsAt) ? ' (over for today)' : ''}
              </option>
            ))}
          </select>
          {errors.slotId && <span className="field-error">{errors.slotId}</span>}
        </label>

        <label className="field">
          <span className="lbl">{words.where}</span>
          <textarea
            className="input textarea"
            rows={2}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              fixed('address')
            }}
            placeholder="Flat, building, area, city"
            disabled={save.isPending}
          />
          {errors.address && <span className="field-error">{errors.address}</span>}
        </label>

        <label className="field">
          <span className="lbl">Google Maps link (optional)</span>
          <input
            className="input"
            value={mapLink}
            onChange={(e) => {
              setMapLink(e.target.value)
              fixed('mapLink')
            }}
            placeholder="https://maps.app.goo.gl/…"
            disabled={save.isPending}
          />
          <span className="hint">If the client shared their location, paste the link: his Directions button opens it.</span>
          {errors.mapLink && <span className="field-error">{errors.mapLink}</span>}
        </label>

        <div className="kv">
          <span>He calls</span>
          <strong className="mono">{c.client.mobile}</strong>
        </div>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={save.isPending || noEmail} onClick={press}>
            {save.isPending ? 'Saving…' : job ? 'Save' : 'Book'}
          </button>
        </div>
      </div>
    </div>
  )
}
