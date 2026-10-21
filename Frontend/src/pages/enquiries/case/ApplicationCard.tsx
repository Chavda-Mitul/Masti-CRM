import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { RequiredMark } from '../../../components/FormField'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { formatDateTime, istParts, istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { useUpdateApplication } from '../queries'
import type { CaseTraveller, VisaCase } from '../types'
import { travellerTab } from './labels'

/** What the API keeps: capitals and digits, 4–40. Spaces are dropped and letters capitalised as you type. */
const ACK_NO = /^[A-Z0-9]{4,40}$/
const cleanAckNo = (text: string) => text.replace(/\s+/g, '').toUpperCase()

/**
 * "Apply on the government portal" (demo screen 08 ⚠️, 0007 Decision 5): each traveller's acknowledgement number and
 * appointment, typed in from the portal during file preparation by the processor, the HOD or the Head. The appointment
 * is asked for only when the visa's "Appointment needed" is on. "Log in for me" and the passport-scan and form buttons
 * are pending (0007 Decision 2), so they aren't shown.
 */
export function ApplicationCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  if (!c.maturedAt) return null
  const editable =
    !!me && c.status === 'OPEN' && c.stage.code === 'FILE_PREPARATION' && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad application">
      <h2 className="h2">Apply on the government portal</h2>
      {editable && (
        <p className="muted small" style={{ margin: 0 }}>
          Type in each traveller’s acknowledgement number{c.appointmentNeeded && ' and appointment'} from the portal.
        </p>
      )}
      <div className="application-scroll">
        <table className="table application-table">
          <thead>
            <tr>
              <th>Traveller</th>
              {/* Needed by "File ready", not by each row's Save: a row can be saved half done. */}
              <th>Acknowledgement no. (typed in){editable && <RequiredMark />}</th>
              {c.appointmentNeeded && <th>Appointment{editable && <RequiredMark />}</th>}
              {editable && <th aria-label="Save" />}
            </tr>
          </thead>
          <tbody>
            {c.travellers.map((t) =>
              editable ? (
                // Keyed on the saved values, so a row starts again from what the server kept.
                <ApplicationRow key={`${t.id}:${t.ackNo}:${t.appointmentAt}`} caseNo={c.caseNo} traveller={t} appointmentNeeded={c.appointmentNeeded} />
              ) : (
                <tr key={t.id}>
                  <td>
                    <strong>{travellerTab(t).name}</strong>
                  </td>
                  <td className="mono">{t.ackNo ?? <span className="muted">—</span>}</td>
                  {c.appointmentNeeded && <td>{t.appointmentAt ? formatDateTime(t.appointmentAt) : <span className="muted">—</span>}</td>}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {!c.appointmentNeeded && (
        <p className="muted small" style={{ margin: 0 }}>
          This visa needs no appointment.
        </p>
      )}
    </section>
  )
}

type RowErrors = { ackNo?: string | undefined; appointment?: string | undefined }

function ApplicationRow({ caseNo, traveller: t, appointmentNeeded }: { caseNo: string; traveller: CaseTraveller; appointmentNeeded: boolean }) {
  const toast = useToast()
  const update = useUpdateApplication(caseNo)
  // An appointment on or after the departure day: check, then save anyway.
  const guard = useWarningGuard()
  const saved = t.appointmentAt ? istParts(t.appointmentAt) : { date: '', time: '' }
  const [ackNo, setAckNo] = useState(t.ackNo ?? '')
  const [on, setOn] = useState(saved.date)
  const [at, setAt] = useState(saved.time)
  /** From the last Save: the server's answer, or a time that had already gone. Cleared when that field is edited. */
  const [saveErrors, setSaveErrors] = useState<RowErrors>({})
  const name = travellerTab(t).name

  const ack = cleanAckNo(ackNo)
  const ackChanged = (ack || null) !== t.ackNo
  const appointmentChanged = appointmentNeeded && (on !== saved.date || at !== saved.time)

  const ackError = ack && !ACK_NO.test(ack) ? 'Capitals and digits only, 4–40 characters.' : saveErrors.ackNo
  const appointmentError = !appointmentChanged
    ? undefined
    : on && !at
      ? 'Pick the time too.'
      : at && !on
        ? 'Pick the day too.'
        : saveErrors.appointment

  const save = () => {
    if (appointmentChanged && on && at && new Date(`${on}T${at}:00+05:30`).getTime() <= Date.now()) {
      setSaveErrors({ appointment: 'Pick a time later than now.' })
      return
    }
    setSaveErrors({})
    const send = (confirmWarnings: boolean) =>
      update.mutate(
        {
          travellerId: t.id,
          ...(ackChanged ? { ackNo: ack || null } : {}),
          ...(appointmentChanged ? { appointment: on && at ? { on, at } : null } : {}),
          ...(confirmWarnings ? { confirmWarnings } : {}),
        },
        {
          onSuccess: () => toast({ tone: 'ok', message: `Saved for ${name}.` }),
          onError: (err) => {
            if (guard.intercept(err, () => send(true))) return
            const issues = errorBody(err)?.issues
            if (issues?.ackNo || issues?.appointment) setSaveErrors({ ackNo: issues.ackNo?.[0], appointment: issues.appointment?.[0] })
            else toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save. Please try again.' })
          },
        },
      )
    send(false)
  }

  return (
    <tr>
      <td>
        <strong>{name}</strong>
      </td>
      <td>
        <input
          className="input mono ack-input"
          value={ackNo}
          maxLength={60}
          placeholder="e.g. FRA1MU20261006481"
          aria-label={`Acknowledgement no. for ${name}`}
          aria-invalid={!!ackError}
          onChange={(e) => {
            setAckNo(e.target.value.toUpperCase())
            setSaveErrors({ ...saveErrors, ackNo: undefined })
          }}
        />
        {ackError && <span className="field-error">{ackError}</span>}
      </td>
      {appointmentNeeded && (
        <td>
          <div className="appointment-inputs">
            <input
              className="input"
              type="date"
              min={istToday()}
              value={on}
              aria-label={`Appointment day for ${name}`}
              onChange={(e) => {
                setOn(e.target.value)
                setSaveErrors({ ...saveErrors, appointment: undefined })
              }}
            />
            <input
              className="input"
              type="time"
              value={at}
              aria-label={`Appointment time for ${name}`}
              onChange={(e) => {
                setAt(e.target.value)
                setSaveErrors({ ...saveErrors, appointment: undefined })
              }}
            />
          </div>
          {appointmentError && <span className="field-error">{appointmentError}</span>}
        </td>
      )}
      <td className="application-save">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!(ackChanged || appointmentChanged) || !!ackError || !!appointmentError || update.isPending}
          onClick={save}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        {guard.modal}
      </td>
    </tr>
  )
}
