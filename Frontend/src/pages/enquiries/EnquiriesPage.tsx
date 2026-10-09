import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { can } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { errorText } from '../../lib/apiErrors'
import { departmentStyle, SELLING_DEPARTMENTS } from '../../lib/departments'
import { formatMobile, initials } from '../../lib/format'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import '../../styles/enquiries.css'
import { dueOf } from './due'
import { useEnquiryList } from './queries'
import type { DepartmentChip, EnquiryListFilters, EnquiryRow } from './types'

/** The selling departments get a chip; any other department (Accounts…) only when it has open enquiries. */
const SELLING = new Set<string>(SELLING_DEPARTMENTS)

/**
 * All enquiries (demo screens 02/03): every department in one list, late first, then by time due.
 * Department, "Only mine" and search live in the URL (?department=VISA&mine=true&q=), so the sidebar can link to a
 * department and Back returns to the same list. Clicking a row opens its steps on the right.
 */
export function EnquiriesPage() {
  const { data: me } = useMe()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const [search, setSearch] = useState(urlQ)
  const q = useDebouncedValue(search.trim(), 300)
  // The New enquiry form sends us here with the case it just saved: open it.
  const [selected, setSelected] = useState<string | null>((location.state as { selected?: string } | null)?.selected ?? null)

  // Follow the URL when it changes without a remount (sidebar links, Back/Forward).
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ)
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ)
    if (urlQ !== q) setSearch(urlQ)
  }

  const filters: EnquiryListFilters = {
    department: params.get('department')?.toUpperCase() ?? '',
    mine: params.get('mine') === 'true',
    q,
  }
  const list = useEnquiryList(filters)

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (q) next.set('q', q)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [q, setParams])

  const setParam = (key: 'department' | 'mine', value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  if (!me) return null

  const firstPage = list.data?.pages[0]
  const departments = (firstPage?.departments ?? []).filter((d) => SELLING.has(d.code) || d.count > 0 || d.code === filters.department)
  const current = departments.find((d) => d.code === filters.department)
  const rows = list.data?.pages.flatMap((p) => p.enquiries) ?? []
  const total = current ? current.count : departments.reduce((sum, d) => sum + d.count, 0)
  const picked = rows.find((r) => r.id === selected) ?? null
  const style = current ? departmentStyle(current.code) : null
  const canAdd = can(me, 'VISA', 'EDIT')

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1 title-dot">
            <span className="dot dot-lg" style={{ background: style?.solid ?? 'var(--primary)' }} />
            {current ? `${current.name} enquiries` : 'All enquiries'}
          </h1>
          <p>
            {firstPage
              ? `${total} open · ${firstPage.lateCount} running late · late first, then by time due · click a row to see its steps`
              : 'Every open enquiry, late first, then by time due.'}
          </p>
        </div>
        <div className="head-actions">
          <label className="check">
            <input type="checkbox" checked={filters.mine} onChange={(e) => setParam('mine', e.target.checked ? 'true' : '')} />
            Only mine
          </label>
          {canAdd && (
            <Link to="/enquiries/new" className="btn btn-primary">
              + New enquiry
            </Link>
          )}
        </div>
      </div>

      <div className="dept-chips" role="tablist" aria-label="Department">
        <button
          type="button"
          role="tab"
          aria-selected={!filters.department}
          className={`dept-chip${filters.department ? '' : ' on'}`}
          onClick={() => setParam('department', '')}
        >
          All departments
        </button>
        {departments.map((d) => (
          <button
            key={d.code}
            type="button"
            role="tab"
            aria-selected={filters.department === d.code}
            className={`dept-chip${filters.department === d.code ? ' on' : ''}`}
            onClick={() => setParam('department', d.code)}
          >
            <span className="dot" style={{ background: departmentStyle(d.code).solid }} />
            {d.name}
            <span className="dept-count">{d.count}</span>
          </button>
        ))}
      </div>

      <div className={`enquiries-layout${picked ? ' with-panel' : ''}`}>
        <div className="card card-fill" style={{ overflow: 'hidden' }}>
          <div className="pad enq-toolbar">
            <input
              className="input search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a case number, client name or mobile"
              aria-label="Search enquiries"
            />
          </div>

          {list.isPending ? (
            <div className="pad muted card-fill-empty">Loading…</div>
          ) : list.isError ? (
            <div className="pad">
              <div className="alert alert-bad">{errorText(list.error)}</div>
            </div>
          ) : rows.length === 0 ? (
            <div className="pad muted card-fill-empty">
              {filters.q || filters.mine ? 'No enquiries match.' : 'No open enquiries.'}
              {canAdd && !filters.q && !filters.mine && (
                <div style={{ marginTop: 12 }}>
                  <Link to="/enquiries/new" className="btn btn-primary">
                    + New enquiry
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <table className="table enquiries-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Department</th>
                  <th>Stage</th>
                  <th className="col-next">Next step</th>
                  <th>Due</th>
                  <th>Who</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <EnquiryTableRow key={e.id} row={e} on={e.id === selected} onClick={() => setSelected(e.id === selected ? null : e.id)} />
                ))}
              </tbody>
            </table>
          )}

          {list.hasNextPage && (
            <div className="pad" style={{ textAlign: 'center' }}>
              <button className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </div>

        {picked && (
          <EnquiryPanel
            row={picked}
            department={firstPage?.departments.find((d) => d.code === picked.department.code)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </>
  )
}

function EnquiryTableRow({ row, on, onClick }: { row: EnquiryRow; on: boolean; onClick: () => void }) {
  const style = departmentStyle(row.department.code)
  const due = dueOf(row.dueAt)
  const name = row.client.name
  return (
    <tr className={on ? 'row-on' : undefined} onClick={onClick}>
      <td>
        <div className="client-cell">
          <span className="avatar" style={{ background: style.tint, color: style.text }}>
            {row.client.name ? initials(row.client.name) : '?'}
          </span>
          <div style={{ minWidth: 0 }}>
            <button type="button" className="enq-name" onClick={(ev) => {
                ev.stopPropagation()
                onClick()
              }}>
              {name}
            </button>
            <div className="muted small ellipsis">
              <span className="mono">{row.caseNo}</span> · {row.summary}
            </div>
          </div>
        </div>
      </td>
      <td>
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {row.department.name}
        </span>
      </td>
      <td className="stage-cell">
        <div className="small" style={{ fontWeight: 700 }}>
          {row.stage.name} · {row.stage.step}/{row.stage.of}
        </div>
        <StageBar step={row.stage.step} of={row.stage.of} color={style.solid} />
      </td>
      <td className="small col-next">{row.stage.nextStepLabel}</td>
      <td className={`small due due-${due.tone}`}>{due.text}</td>
      <td>
        {row.owner ? (
          <span className="avatar avatar-sm" title={row.owner.name}>
            {initials(row.owner.name)}
          </span>
        ) : (
          <span className="muted small">—</span>
        )}
      </td>
    </tr>
  )
}

function StageBar({ step, of, color }: { step: number; of: number; color: string }) {
  return (
    <div className="stage-bar" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} style={i < step ? { background: color } : undefined} />
      ))}
    </div>
  )
}

/** The demo's right-hand panel: the case's steps, what's next and who has it. The full case page comes next. */
function EnquiryPanel({ row, department, onClose }: { row: EnquiryRow; department: DepartmentChip | undefined; onClose: () => void }) {
  const style = departmentStyle(row.department.code)
  const due = dueOf(row.dueAt)
  return (
    <aside className="card pad enquiry-panel" aria-label={`Enquiry ${row.caseNo}`}>
      <div className="panel-top">
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {row.department.name} · {row.caseNo}
        </span>
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <h2 className="h2" style={{ marginTop: 10 }}>
        {row.client.name}
      </h2>
      <p className="muted small" style={{ margin: '4px 0 0' }}>
        {row.summary}
        {` · ${formatMobile(row.client.mobile)}`}
      </p>
      <p className="muted small" style={{ margin: '2px 0 0' }}>
        Came in through {row.source.name}
      </p>

      <div className="lbl" style={{ marginTop: 18 }}>
        {row.department.name} steps
      </div>
      <ol className="step-list">
        {(department?.stages ?? []).map((s, i) => {
          const done = i + 1 < row.stage.step
          const now = i + 1 === row.stage.step
          return (
            <li key={s.code} className={done ? 'done' : now ? 'now' : undefined}>
              <span className="step-mark" style={done || now ? { background: style.solid, color: 'var(--on-fill)' } : undefined}>
                {done ? '✓' : i + 1}
              </span>
              {s.name}
            </li>
          )
        })}
      </ol>

      <div className="lbl" style={{ marginTop: 18 }}>
        Next step
      </div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{row.stage.nextStepLabel}</div>
      <div className="small" style={{ marginTop: 2 }}>
        Due <span className={`due due-${due.tone}`}>{due.text}</span>
        {row.owner && ` · ${row.owner.name}`}
      </div>

      <button type="button" className="btn" style={{ marginTop: 18, width: '100%' }} disabled title="The case page comes with the next step">
        Open full case › <span className="tag">Soon</span>
      </button>
    </aside>
  )
}
