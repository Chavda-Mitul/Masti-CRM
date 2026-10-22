import { useState } from 'react'
import { useMe } from '../../auth/useAuth'
import { RefreshFailed } from '../../components/RefreshFailed'
import { errorText, lostAccess } from '../../lib/apiErrors'
import '../../styles/today.css'
import { BusinessLostCard, MoneyToCollectCard } from './ComesWithCards'
import { DepartmentBarsCard } from './DepartmentBarsCard'
import { greetingNow, heroLine, longToday, newSinceLabel, oldestLabel, scopeLabel } from './labels'
import { NoticeBoardCard } from './NoticeBoardCard'
import { useToday } from './queries'
import { UpNextCard } from './UpNextCard'

/**
 * Today, everyone's home page (docs/decisions/0017-today-dashboard.md, demo screen 01): the day's sentence, four tiles,
 * then two columns: Up next and Business lost; open enquiries by department, the notice board and Money to collect.
 */
export function TodayPage() {
  const { data: me } = useMe()
  const today = useToday()
  const [greeting] = useState(() => greetingNow())
  if (!me) return null
  const day = today.data
  // Due today and Running late are Up next's rows (Decision 2).
  const toUpNext = () => document.getElementById('up-next')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="today">
      <section className="today-hero">
        <HeroArt />
        <div className="today-hero-text">
          <span className="today-date">{longToday()}</span>
          <h1 className="today-greeting">
            {greeting}, {me.name.split(' ')[0]}
          </h1>
          {day && <p>{heroLine(day.dueToday, day.late)}</p>}
        </div>
      </section>

      <div className="today-tiles">
        {today.isLoadingError || lostAccess(today) ? (
          <div className="alert alert-bad">{errorText(today.error)}</div>
        ) : (
          <>
            <Tile label="Due today" value={day?.dueToday} note={day && scopeLabel(day.scope)} onClick={toUpNext} />
            <Tile label="Running late" value={day?.late} note={day && oldestLabel(day.oldestLateAt)} tone={day?.late ? 'late' : undefined} onClick={toUpNext} />
            <Tile label="New enquiries" value={day?.newEnquiries} note={day && newSinceLabel(day.newSince)} tone="primary" />
            {/* 0017 Decision 4: cross-sell leads come with Stage 3. */}
            <Tile label="Cross-sell to answer" value="—" note="Comes with cross-sell" tone="muted" />
          </>
        )}
      </div>

      {/* Below the tiles: they sit over the banner, and would hide it. */}
      <RefreshFailed query={today} what="this page" />
      {!(today.isLoadingError || lostAccess(today)) && (
        <div className="today-grid">
          <div className="today-col">
            <UpNextCard day={day} />
            <BusinessLostCard />
          </div>
          <div className="today-col">
            <DepartmentBarsCard day={day} />
            <NoticeBoardCard day={day} />
            <MoneyToCollectCard />
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string
  value: number | string | undefined
  note: string | undefined
  tone?: 'late' | 'primary' | 'muted' | undefined
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="today-tile-label">{label}</span>
      <strong className={tone ? `today-tile-value is-${tone}` : 'today-tile-value'}>{value ?? '…'}</strong>
      <span className="today-tile-note">{note ?? ' '}</span>
    </>
  )
  return onClick ? (
    <button type="button" className="today-tile is-link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="today-tile">{body}</div>
  )
}

/** The demo's sun, plane and waves. */
function HeroArt() {
  return (
    <svg className="today-hero-art" width="380" height="180" viewBox="0 0 380 180" fill="none" aria-hidden="true">
      <circle className="sun" cx="286" cy="74" r="40" />
      <path className="wave-back" d="M0 138 C 60 118, 130 158, 190 136 S 316 116, 380 138 L380 180 L0 180 Z" />
      <path className="wave-front" d="M0 156 C 74 138, 150 174, 222 154 S 336 140, 380 158 L380 180 L0 180 Z" />
      <path className="plane" d="M152 50 l42 -8 l-6 6 l23 2 l4 -4 l4 6 l-4 4 l-25 4 l4 8 l-6 2 l-10 -10 l-25 6 z" />
    </svg>
  )
}
