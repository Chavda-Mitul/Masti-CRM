import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { errorText } from '../../lib/apiErrors'
import { currentPlace, type Place } from '../../lib/place'
import { useToast } from '../../lib/toast'
import { dayName, KIND_LABEL, shortDay } from './labels'
import { useFailReasons, useMarkFailed, useStop } from './queries'
import { StopCard } from './StopCard'
import type { RunStop } from './types'
import '../../styles/field.css'

/** Why a booked stop can't be recorded now (another day's), or null. A finished or called-off one says so on its card. */
function notToday(stop: RunStop, today: string): string | null {
  if (stop.status !== 'BOOKED') return null
  if (stop.day < today) return `This stop was on ${shortDay(stop.day)}. Ask the office to book it again.`
  if (stop.day > today) return `This stop is on ${shortDay(stop.day)}. You can record it on the day.`
  return null
}

/**
 * One stop on the boy's phone (demo screen 14; docs/decisions/0015-field-staff-app.md, phase 4): the stop as on his run,
 * and what he records at the door, on the day: "Couldn't complete" (Decision 5). Another day's stop is read-only.
 */
export function FieldStopPage() {
  const { jobId = '' } = useParams()
  const query = useStop(jobId)
  const data = query.data
  const why = data ? notToday(data.stop, data.today) : null
  const canRecord = data !== undefined && data.stop.status === 'BOOKED' && why === null

  return (
    <div className="field-page">
      <div className="field-column">
        <header className="field-head">
          <div className="field-head-row">
            <Link to="/tasks" className="field-back" aria-label="Back to your run">
              ‹
            </Link>
            <div className="field-head-text">
              <h1 className="field-title">{data ? `${KIND_LABEL[data.stop.kind]} · ${data.stop.slot.name}` : 'Your stop'}</h1>
              <div className="field-sub">{data ? dayName(data.stop.day, data.today) : 'Collection & delivery'}</div>
            </div>
          </div>
        </header>

        <main className="field-stops">
          {query.isPending ? (
            <p className="field-note muted">Loading the stop…</p>
          ) : !data ? (
            <div className="field-error">
              <div className="alert alert-bad">{errorText(query.error)}</div>
              <div className="field-error-actions">
                <Link to="/tasks" className="btn">
                  Back to your run
                </Link>
              </div>
            </div>
          ) : (
            <>
              {query.isError && <div className="alert alert-warn">Can&apos;t reach the office right now. This is the stop as it last loaded.</div>}
              <StopCard stop={data.stop} number={null} />
              {why && <p className="field-note muted">{why}</p>}
              {canRecord && <CouldntComplete jobId={data.stop.id} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * "Couldn't complete" (Decision 5): he picks why from the office's list, and his phone adds where he is and the time.
 * The case goes back to the office, due now, to book again; he's taken back to his run.
 */
function CouldntComplete({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false)
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [locating, setLocating] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reasons = useFailReasons(open)
  const mark = useMarkFailed(jobId)
  const toast = useToast()
  const navigate = useNavigate()

  if (!open) {
    return (
      <button type="button" className="btn field-fail-open" onClick={() => setOpen(true)}>
        Couldn&apos;t complete
      </button>
    )
  }

  const record = async () => {
    if (reasonId === null) return
    setProblem(null)
    setLocating(true)
    let place: Place
    try {
      place = await currentPlace()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Your phone couldn’t find where you are. Try again.')
      return
    } finally {
      setLocating(false)
    }
    mark.mutate(
      { reasonId, place },
      {
        onSuccess: () => {
          toast({ tone: 'ok', message: 'Recorded. The office will book it again.' })
          navigate('/tasks')
        },
      },
    )
  }
  const busy = locating || mark.isPending
  const message = problem ?? errorText(mark.error)

  return (
    <section className="card field-fail" aria-labelledby="field-fail-title">
      <h2 id="field-fail-title" className="field-fail-title">
        Couldn&apos;t complete
      </h2>
      <p className="muted field-fail-hint">Pick why. Your phone adds where you are and the time.</p>
      {reasons.isPending ? (
        <p className="muted">Loading the reasons…</p>
      ) : reasons.isError ? (
        <div className="alert alert-bad">{errorText(reasons.error)}</div>
      ) : (
        <div className="field-reasons" role="radiogroup" aria-label="Why">
          {reasons.data.map((r) => (
            <label key={r.id} className={`field-reason${reasonId === r.id ? ' is-picked' : ''}`}>
              <input type="radio" name="fail-reason" checked={reasonId === r.id} onChange={() => setReasonId(r.id)} disabled={busy} />
              {r.name}
            </label>
          ))}
        </div>
      )}
      {message && <div className="alert alert-bad">{message}</div>}
      <div className="field-fail-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen(false)
            setProblem(null)
          }}
          disabled={busy}
        >
          Back
        </button>
        <button type="button" className="btn btn-dark" onClick={() => void record()} disabled={busy || reasonId === null}>
          {locating ? 'Getting your location…' : mark.isPending ? 'Saving…' : 'Record'}
        </button>
      </div>
    </section>
  )
}
