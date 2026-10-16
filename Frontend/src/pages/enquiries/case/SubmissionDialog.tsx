import { useState } from 'react'
import { Link } from 'react-router'
import { canEditEmbassies } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useSaveSubmission } from '../queries'
import type { VisaCase } from '../types'
import { OpenDayCalendar } from './OpenDayCalendar'

/**
 * "Submitted at the embassy" (docs/decisions/0011-visa-at-vendor.md Decisions 3 and 4): the vendor's file number, the
 * embassy it went to (filled in when the country has only one) and the expected collection date, saved together. The
 * same dialog changes them later at Step 5 ("Change" on the Expected collection date card).
 */
export function SubmissionDialog({ visaCase: c, onClose }: { visaCase: VisaCase; onClose: () => void }) {
  const { data: me } = useMe()
  const toast = useToast()
  const save = useSaveSubmission(c.caseNo)
  const embassies = useMasterList('embassies')
  const s = c.submission
  const options = (embassies.data ?? []).filter((e) => e.countryId === c.country.id && (e.isActive || e.id === s?.embassy.id))
  const [fileNo, setFileNo] = useState(s?.vendorFileNo ?? '')
  const [picked, setPicked] = useState<number | null>(s?.embassy.id ?? null)
  const [collectionOn, setCollectionOn] = useState<string | null>(s?.collectionOn ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // The only embassy for the country is filled in (Decision 3).
  const embassyId = picked ?? (options.length === 1 ? options[0]!.id : null)

  const press = () => {
    const missing: Record<string, string> = {}
    if (!fileNo.trim()) missing.vendorFileNo = 'Enter the vendor’s file number.'
    if (!embassyId) missing.embassyId = 'Pick the embassy.'
    if (!collectionOn) missing.collectionOn = 'Pick the expected collection date.'
    setErrors(missing)
    if (!embassyId || !collectionOn || Object.keys(missing).length) return
    save.mutate(
      { vendorFileNo: fileNo, embassyId, collectionOn, updatedAt: c.updatedAt },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: s ? 'Submission details saved.' : `${c.caseNo} is submitted at the embassy.` })
          onClose()
        },
        onError: (err) => {
          const issues = errorBody(err)?.issues ?? {}
          setErrors(Object.fromEntries(Object.entries(issues).map(([field, messages]) => [field, messages?.[0] ?? ''])))
        },
      },
    )
  }
  const message = errorBody(save.error)?.issues ? null : errorText(save.error)

  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="dialog submission-dialog" role="dialog" aria-modal="true" aria-labelledby="submission-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="submission-title">
          {s ? 'Change the submission' : 'Submitted at the embassy'}
        </h2>
        <label className="field">
          <span className="lbl">File number from vendor</span>
          <input
            className="input mono upper"
            value={fileNo}
            onChange={(e) => setFileNo(e.target.value)}
            disabled={save.isPending}
            placeholder="FR-MUM-88421"
            autoComplete="off"
            autoFocus
          />
          {errors.vendorFileNo && <span className="field-error">{errors.vendorFileNo}</span>}
          <span className="hint">As the vendor sent it: letters, digits, - or /. Spaces are dropped.</span>
        </label>

        <div className="field">
          <span className="lbl">Embassy</span>
          {embassies.isPending ? (
            <span className="muted small">Loading…</span>
          ) : options.length === 0 ? (
            <span className="muted small">
              {me && canEditEmbassies(me) ? (
                <>
                  No embassy for {c.country.name} yet. <Link to="/settings/masters/lists?tab=embassies">Add one in Embassies</Link>
                </>
              ) : (
                `No embassy for ${c.country.name} yet — ask the Visa HOD to add one.`
              )}
            </span>
          ) : options.length === 1 ? (
            <strong>{options[0]!.name}</strong>
          ) : (
            <select
              className="select"
              value={embassyId ?? ''}
              onChange={(e) => {
                setPicked(e.target.value ? Number(e.target.value) : null)
                setCollectionOn(null)
              }}
              disabled={save.isPending}
            >
              <option value="">Pick the embassy…</option>
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          {errors.embassyId && <span className="field-error">{errors.embassyId}</span>}
        </div>

        <div className="field">
          <span className="lbl">Expected collection date</span>
          <span className="hint" style={{ marginTop: 0 }}>
            Holidays and Sundays at this embassy can’t be picked.
          </span>
          <OpenDayCalendar
            target={embassyId ? { embassyId } : null}
            label="Expected collection"
            value={collectionOn}
            onChange={setCollectionOn}
            disabled={save.isPending}
          />
          {errors.collectionOn && <span className="field-error">{errors.collectionOn}</span>}
        </div>

        {message && <div className="alert alert-bad">{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={save.isPending || options.length === 0} onClick={press}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
