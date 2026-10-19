import { useState } from 'react'
import { canActOnCase } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { FormField } from '../../../components/FormField'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { formatDate, istToday } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useWarningGuard } from '../../../lib/useWarningGuard'
import { useUpdateTrip } from '../queries'
import type { CaseTrip, EntryType, VisaCase } from '../types'

const ENTRY_LABEL: Record<EntryType, string> = { SINGLE: 'Single', DOUBLE: 'Double', MULTIPLE: 'Multiple' }
const ENTRY_TYPES = ['SINGLE', 'DOUBLE', 'MULTIPLE'] as const

/** The steps trip details can change at: as the documents come in, and during file preparation. */
const EDITABLE_AT = ['ENQUIRY', 'DOCUMENTS', 'FILE_PREPARATION']

/** Days away, both ends counted (1 Oct → 7 Oct is 7 days), as the visa counts them. */
function tripDays(from: string | null, to: string | null): number | null {
  if (!from || !to || to < from) return null
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}
const daysText = (days: number | null) => (days === null ? null : days === 1 ? '1 day' : `${days} days`)

/**
 * "Trip details" (0007 Decision 4): what the forms and the covering letter will need, captured as the documents come in
 * and corrected during file preparation. Travelling out, coming back and the entry type are needed before the file is
 * ready; the hotel stay is optional. The case's owner, its HOD or the Head can change them.
 */
export function TripCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const editable =
    !!me && c.status === 'OPEN' && EDITABLE_AT.includes(c.stage.code) && canActOnCase(me, { department: c.department.code, owner: c.owner })

  return (
    <section className="card pad">
      <h2 className="h2" style={{ marginBottom: 8 }}>
        Trip details
      </h2>
      {/* Keyed on the saved values, so the form starts again from what the server kept. */}
      {editable ? <TripForm key={JSON.stringify(c.trip)} visaCase={c} /> : <TripView trip={c.trip} />}
    </section>
  )
}

function TripView({ trip }: { trip: CaseTrip }) {
  const notSet = <span className="muted">Not set yet</span>
  return (
    <>
      <div className="kv">
        <span>Travelling out</span>
        <strong>{trip.departOn ? formatDate(trip.departOn) : notSet}</strong>
      </div>
      <div className="kv">
        <span>Coming back</span>
        <strong>{trip.returnOn ? formatDate(trip.returnOn) : notSet}</strong>
      </div>
      <div className="kv">
        <span>Duration</span>
        <strong>{daysText(tripDays(trip.departOn, trip.returnOn)) ?? notSet}</strong>
      </div>
      <div className="kv">
        <span>Entry</span>
        <strong>{trip.entryType ? ENTRY_LABEL[trip.entryType] : notSet}</strong>
      </div>
      <div className="kv">
        <span>Hotel stay</span>
        <strong>{trip.hotelStay ?? notSet}</strong>
      </div>
    </>
  )
}

type TripErrors = Partial<Record<keyof CaseTrip, string>>
const FIELDS = ['departOn', 'returnOn', 'entryType', 'hotelStay'] as const

function TripForm({ visaCase: c }: { visaCase: VisaCase }) {
  const toast = useToast()
  const update = useUpdateTrip(c.caseNo)
  // A new return that a linked passport doesn't run long enough after: check, then save anyway.
  const guard = useWarningGuard()
  const [departOn, setDepartOn] = useState(c.trip.departOn ?? '')
  const [returnOn, setReturnOn] = useState(c.trip.returnOn ?? '')
  const [entryType, setEntryType] = useState<EntryType | null>(c.trip.entryType)
  const [hotelStay, setHotelStay] = useState(c.trip.hotelStay ?? '')
  const [serverErrors, setServerErrors] = useState<TripErrors>({})

  const draft: CaseTrip = { departOn: departOn || null, returnOn: returnOn || null, entryType, hotelStay: hotelStay.trim() || null }
  const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== c.trip[key as keyof CaseTrip]))
  const dirty = Object.keys(changed).length > 0
  const today = istToday()

  const errors: TripErrors = { ...serverErrors }
  if (draft.departOn && draft.departOn !== c.trip.departOn && draft.departOn < today) errors.departOn = 'Travelling out can’t be in the past.'
  if (draft.departOn && draft.returnOn && draft.returnOn < draft.departOn) errors.returnOn = 'Coming back can’t be before travelling out.'
  const valid = !errors.departOn && !errors.returnOn
  const missing = !c.trip.departOn || !c.trip.returnOn || !c.trip.entryType

  const save = (confirmWarnings = false): void => {
    setServerErrors({})
    update.mutate(confirmWarnings ? { ...changed, confirmWarnings } : changed, {
      onSuccess: () => toast({ tone: 'ok', message: 'Trip details saved.' }),
      onError: (err) => {
        if (guard.intercept(err, () => save(true))) return
        const issues = errorBody(err)?.issues ?? {}
        const shown = FIELDS.filter((field) => issues[field]?.[0])
        if (shown.length > 0) setServerErrors(Object.fromEntries(shown.map((field) => [field, issues[field]![0]])))
        else toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t save. Please try again.' })
      },
    })
  }
  const edited = (field: keyof CaseTrip) => {
    if (serverErrors[field]) setServerErrors({ ...serverErrors, [field]: undefined })
  }

  return (
    <div className="trip-form">
      <div className="form-grid">
        <FormField label="Travelling out" error={errors.departOn}>
          <input
            className="input"
            type="date"
            min={today}
            value={departOn}
            onChange={(e) => {
              setDepartOn(e.target.value)
              edited('departOn')
            }}
          />
        </FormField>
        <FormField label="Coming back" error={errors.returnOn}>
          <input
            className="input"
            type="date"
            min={departOn || today}
            value={returnOn}
            onChange={(e) => {
              setReturnOn(e.target.value)
              edited('returnOn')
            }}
          />
        </FormField>
        <div className="field">
          <span>Duration</span>
          <strong className="trip-duration">{daysText(tripDays(draft.departOn, draft.returnOn)) ?? <span className="muted">—</span>}</strong>
        </div>
        <div className="field">
          <span>Entry</span>
          <div className="seg-btn" role="radiogroup" aria-label="Entry">
            {ENTRY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={entryType === t}
                className={entryType === t ? 'on' : ''}
                onClick={() => {
                  setEntryType(t)
                  edited('entryType')
                }}
              >
                {ENTRY_LABEL[t]}
              </button>
            ))}
          </div>
          {errors.entryType && <span className="field-error">{errors.entryType}</span>}
        </div>
        <FormField label="Hotel stay" error={errors.hotelStay} hint="Optional" wide>
          <input
            className="input"
            value={hotelStay}
            maxLength={200}
            placeholder="Hotel name, city"
            onChange={(e) => {
              setHotelStay(e.target.value)
              edited('hotelStay')
            }}
          />
        </FormField>
      </div>
      <div className="trip-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || !valid || update.isPending} onClick={() => save()}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        {missing && <span className="muted small">Travelling out, coming back and the entry type are needed before the file is ready.</span>}
      </div>
      {guard.modal}
    </div>
  )
}
