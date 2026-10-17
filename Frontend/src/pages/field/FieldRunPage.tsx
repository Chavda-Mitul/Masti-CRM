import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLogout, useMe } from '../../auth/useAuth'
import { errorText } from '../../lib/apiErrors'
import { addDays } from '../../lib/format'
import { firstName } from '../enquiries/case/labels'
import { dayName, noStops, shortDay } from './labels'
import { useMyRun } from './queries'
import { StopCard } from './StopCard'
import type { RunStop } from './types'
import '../../styles/field.css'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A stop's piece of the progress bar: done, couldn't complete, the one he's on, or still to come. */
function segmentClass(stop: RunStop, nowId: string | undefined): string {
  if (stop.status === 'DONE') return 'is-done'
  if (stop.status === 'FAILED') return 'is-failed'
  return stop.id === nowId ? 'is-now' : ''
}

/**
 * The collection and delivery boy's phone screen (demo screen 14; docs/decisions/0015-field-staff-app.md, phase 3): his
 * run for a day, stop by stop, with Call and Directions. It opens on today; ‹ › step to other days (?day=). Today's
 * booked stops open their own screen, where he records them (phase 4).
 */
export function FieldRunPage() {
  const { data: user } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const asked = params.get('day')
  const day = asked && DAY.test(asked) ? asked : null
  const run = useMyRun(day)
  const data = run.data
  const today = data?.today
  const shown = day ?? today

  // Today drops the ?day=, so a phone left open reopens on whatever day it then is.
  const goTo = (target: string) => setParams(target === today ? {} : { day: target }, { replace: true })
  const onLogout = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })

  const live = data?.jobs.filter((s) => s.status !== 'CANCELLED') ?? []
  const onToday = shown !== undefined && shown === today
  // The stop he's on: the first one still booked, on today's run.
  const nowId = onToday ? live.find((s) => s.status === 'BOOKED')?.id : undefined

  return (
    <div className="field-page">
      <div className="field-column">
        <header className="field-head">
          <div className="field-head-row">
            <div className="field-mark" aria-hidden>
              M
            </div>
            <div className="field-head-text">
              <h1 className="field-title">
                {user && firstName(user.name)}&apos;s run{shown && ` · ${shortDay(shown)}`}
              </h1>
              <div className="field-sub">Collection &amp; delivery</div>
            </div>
            {data && data.total > 0 && (
              <span className="field-count">
                {data.done} of {data.total} done
              </span>
            )}
          </div>
          {live.length > 0 && (
            <div className="field-progress" aria-hidden>
              {live.map((s) => (
                <span key={s.id} className={segmentClass(s, nowId)} />
              ))}
            </div>
          )}
        </header>

        {shown && today && (
          <nav className="field-days" aria-label="Days">
            <button className="btn" onClick={() => goTo(addDays(shown, -1))}>
              ‹ {dayName(addDays(shown, -1), today)}
            </button>
            <span className="field-day">{dayName(shown, today)}</span>
            <button className="btn" onClick={() => goTo(addDays(shown, 1))}>
              {dayName(addDays(shown, 1), today)} ›
            </button>
          </nav>
        )}

        <main className="field-stops" aria-busy={run.isPlaceholderData || undefined}>
          {run.isPending ? (
            <p className="field-note muted">Loading your run…</p>
          ) : !data ? (
            <div className="field-error">
              <div className="alert alert-bad">{errorText(run.error)}</div>
              <div className="field-error-actions">
                <button className="btn" onClick={() => void run.refetch()} disabled={run.isFetching}>
                  Try again
                </button>
                {day && (
                  <button className="btn" onClick={() => setParams({}, { replace: true })}>
                    Back to today
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {run.isError && <div className="alert alert-warn">Can&apos;t reach the office right now. This is your run as it last loaded.</div>}
              {data.jobs.length === 0 && <p className="field-note muted">{noStops(data.day, data.today)}</p>}
              {data.jobs.map((stop) => (
                <StopCard
                  key={stop.id}
                  stop={stop}
                  number={stop.status === 'CANCELLED' ? null : live.indexOf(stop) + 1}
                  now={stop.id === nowId}
                  record={onToday}
                />
              ))}
            </>
          )}
        </main>

        <footer className="field-foot">
          <Link to="/change-password" className="btn">
            Change password
          </Link>
          <button className="btn" onClick={onLogout} disabled={logout.isPending}>
            Log out
          </button>
        </footer>
      </div>
    </div>
  )
}
