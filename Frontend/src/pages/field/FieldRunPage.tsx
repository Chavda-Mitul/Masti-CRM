import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLogout, useMe } from '../../auth/useAuth'
import { errorText } from '../../lib/apiErrors'
import { departmentStyle } from '../../lib/departments'
import { addDays, formatMobile } from '../../lib/format'
import { firstName } from '../enquiries/case/labels'
import { useMyRun } from './queries'
import type { FieldJobKind, RunStop } from './types'
import '../../styles/field.css'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const SHORT_DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Sat 31 Oct" for a day (YYYY-MM-DD). */
function shortDay(day: string): string {
  const parts = SHORT_DAY.formatToParts(new Date(`${day}T00:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}`
}

/** "Today", "Yesterday" or "Tomorrow" when it's one of those, else "Sat 31 Oct". */
function dayName(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return shortDay(day)
}

/** "No stops today." or "No stops on Sat 31 Oct." */
function noStops(day: string, today: string): string {
  const name = dayName(day, today)
  return name === shortDay(day) ? `No stops on ${name}.` : `No stops ${name.toLowerCase()}.`
}

// The demo's wording (screens 14 and 25).
const KIND_LABEL: Record<FieldJobKind, string> = { PICKUP: 'Pick up documents', DELIVERY: 'Deliver passports' }
const FINISHED_LABEL = { DONE: 'Done', FAILED: "Couldn't complete" }

/** "2 passports + 1 old", "1 passport", "2 old passports". */
function handOverText({ current, old }: { current: number; old: number }): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (current > 0 && old > 0) return `${count(current, 'passport')} + ${old} old`
  return old > 0 ? count(old, 'old passport') : count(current, 'passport')
}

/** The pending papers, traveller by traveller, in the case's order. */
function byTraveller(pending: RunStop['pending']) {
  const groups: { traveller: string; documents: string[] }[] = []
  for (const p of pending) {
    const last = groups.at(-1)
    if (last?.traveller === p.traveller) last.documents.push(p.document)
    else groups.push({ traveller: p.traveller, documents: [p.document] })
  }
  return groups
}

/** The office's Google Maps link, else directions to the address (a plain Google Maps link: no key, no cost). */
const directionsTo = (stop: RunStop) =>
  stop.mapLink ?? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`

/** A stop's piece of the progress bar: done, couldn't complete, the one he's on, or still to come. */
function segmentClass(stop: RunStop, nowId: string | undefined): string {
  if (stop.status === 'DONE') return 'is-done'
  if (stop.status === 'FAILED') return 'is-failed'
  return stop.id === nowId ? 'is-now' : ''
}

/**
 * The collection and delivery boy's phone screen (demo screen 14; docs/decisions/0015-field-staff-app.md, phase 3): his
 * run for a day, stop by stop, with Call and Directions. It opens on today; ‹ › step to other days (?day=).
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
  // The stop he's on: the first one still booked, on today's run.
  const nowId = shown !== undefined && shown === today ? live.find((s) => s.status === 'BOOKED')?.id : undefined

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
                <StopCard key={stop.id} stop={stop} number={stop.status === 'CANCELLED' ? null : live.indexOf(stop) + 1} now={stop.id === nowId} />
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

/** One stop: when, what, whose, where; Call and Directions while it's booked; and what to hand over or collect. */
function StopCard({ stop, number, now }: { stop: RunStop; number: number | null; now: boolean }) {
  const department = departmentStyle(stop.department)
  const label = [number === null ? null : `Stop ${number}`, stop.slot.name, now ? 'Now' : null].filter(Boolean).join(' · ')
  const client = firstName(stop.client.name)
  const cancelled = stop.status === 'CANCELLED'

  return (
    <article className={`card field-stop${cancelled ? ' is-cancelled' : ''}${now ? ' is-now' : ''}`}>
      <div className="field-stop-top">
        <span className="lbl">{label}</span>
        <span className="chip chip-sm" style={{ background: department.tint, color: department.text }}>
          {KIND_LABEL[stop.kind]}
        </span>
      </div>
      <div>
        <h2 className="field-client">
          {stop.client.name} · {stop.caseNo}
        </h2>
        <p className="field-address">{stop.address}</p>
      </div>

      {stop.status === 'CANCELLED' ? (
        <p className="field-called-off">Called off by the office. Don&apos;t go.</p>
      ) : (
        <>
          {stop.status === 'BOOKED' ? (
            <div className="field-actions">
              <a className="btn" href={`tel:${stop.mobile}`} aria-label={`Call ${client} on ${formatMobile(stop.mobile)}`}>
                Call {client}
              </a>
              <a className="btn" href={directionsTo(stop)} target="_blank" rel="noreferrer">
                Directions
              </a>
            </div>
          ) : (
            <span className={`chip field-finished ${stop.status === 'DONE' ? 'chip-ok' : 'chip-bad'}`}>{FINISHED_LABEL[stop.status]}</span>
          )}
          {stop.kind === 'DELIVERY' && stop.booklets && (
            <div className="field-need">
              <span>Hand over</span>
              <strong>{handOverText(stop.booklets)}</strong>
            </div>
          )}
          {stop.kind === 'PICKUP' && <StillToCollect pending={stop.pending} />}
        </>
      )}
    </article>
  )
}

/** A pickup's papers still pending on the case's checklist, traveller by traveller (names only, nothing scanned). */
function StillToCollect({ pending }: { pending: RunStop['pending'] }) {
  const groups = byTraveller(pending)
  return (
    <div className="field-need field-collect">
      <span>Still to collect</span>
      {groups.length === 0 ? (
        <span className="muted">Nothing pending on the checklist</span>
      ) : (
        <ul>
          {groups.map((g, i) => (
            <li key={`${i}-${g.traveller}`}>
              {/* Not commas: checklist names hold them ("Bank statement, last 6 months"). */}
              <strong>{g.traveller}:</strong> {g.documents.join(' · ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
