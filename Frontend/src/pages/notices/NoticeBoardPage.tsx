import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { can, isHodOf } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { RefreshFailed } from '../../components/RefreshFailed'
import { errorText, lostAccess } from '../../lib/apiErrors'
import { DEPARTMENT_STYLE, departmentStyle } from '../../lib/departments'
import { useToast } from '../../lib/toast'
import '../../styles/notices.css'
import { CATEGORY_LABEL, postedLine, tagLabel } from './labels'
import { NoticeDrawer } from './NoticeDrawer'
import { useNotices, useRemoveNotice } from './queries'
import type { Notice, NoticeCategory } from './types'

/** The department tabs, in menu order: every department, Accounts too (demo screen 27). */
const DEPARTMENTS = Object.keys(DEPARTMENT_STYLE)

/** The filter pills. A general notice shows under Everything only, as in the demo. */
const PILLS: NoticeCategory[] = ['AIRLINE', 'EMBASSY', 'HOTEL']

/**
 * The notice board (docs/decisions/0017-today-dashboard.md Decision 11, demo screen 27): what each department needs to
 * know. Everyone in the office reads every department's notices; the department tab and the pill live in the URL
 * (?department=VISA&about=embassy). A department's staff post to it; the author, the HOD and the Head change a notice.
 */
export function NoticeBoardPage() {
  const { data: me } = useMe()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const department = DEPARTMENTS.find((code) => code === params.get('department')?.toUpperCase()) ?? ''
  const category = PILLS.find((c) => c === params.get('about')?.toUpperCase()) ?? ''
  const notices = useNotices({ department, category })
  const remove = useRemoveNotice()
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)
  const [removing, setRemoving] = useState<Notice | null>(null)

  if (!me) return null

  const postable = DEPARTMENTS.filter((code) => can(me, code, 'EDIT')).map((code) => ({ code, name: departmentStyle(code).label }))
  const rows = notices.data?.pages.flatMap((p) => p.notices) ?? []
  const setParam = (key: 'department' | 'about', value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, key === 'about' ? value.toLowerCase() : value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  return (
    <>
      <Link to="/" className="back-link">
        ‹ Today
      </Link>
      <div className="page-head">
        <div>
          <h1 className="h1">Notice board</h1>
          <p>What each department needs to know, arranged by airline, embassy and hotel — so staff look it up here instead of asking around.</p>
        </div>
        {postable.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + Post a notice
          </button>
        )}
      </div>

      <div className="notice-filters">
        <div className="kind-toggle" role="tablist" aria-label="Department">
          <button type="button" role="tab" aria-selected={!department} className={department ? '' : 'on'} onClick={() => setParam('department', '')}>
            All
          </button>
          {DEPARTMENTS.map((code) => (
            <button key={code} type="button" role="tab" aria-selected={department === code} className={department === code ? 'on' : ''} onClick={() => setParam('department', code)}>
              {departmentStyle(code).label}
            </button>
          ))}
        </div>
        <div className="notice-pills" role="tablist" aria-label="About">
          <button type="button" role="tab" aria-selected={!category} className={category ? 'notice-pill' : 'notice-pill on'} onClick={() => setParam('about', '')}>
            Everything
          </button>
          {PILLS.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={category === c ? 'notice-pill on' : 'notice-pill'} onClick={() => setParam('about', c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <RefreshFailed query={notices} what="the notices" />
      <div className="notices-layout">
        <section className="card notice-board" aria-label="Notices">
          {notices.isPending ? (
            <p className="pad muted">Loading…</p>
          ) : notices.isLoadingError || lostAccess(notices) ? (
            <div className="pad">
              <div className="alert alert-bad">{errorText(notices.error)}</div>
            </div>
          ) : rows.length === 0 ? (
            <p className="pad muted">{department || category ? 'No notices here.' : 'No notices yet.'}</p>
          ) : (
            <ol className="notice-list">
              {rows.map((n) => (
                <NoticeItem key={n.id} notice={n} onEdit={() => setEditing(n)} onRemove={() => setRemoving(n)} />
              ))}
            </ol>
          )}
          {notices.hasNextPage && (
            <div className="pad" style={{ textAlign: 'center' }}>
              <button className="btn" onClick={() => void notices.fetchNextPage()} disabled={notices.isFetchingNextPage}>
                {notices.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </section>

        {/* 0017 Decision 11: the demo's weather and IVS cards say what they wait for. */}
        <aside className="notice-side">
          <section className="card pad comes-with">
            <h2 className="h2">Weather · next 10 days' travellers</h2>
            <p className="muted small">Comes once Masti decides whether to show it, and where the forecasts come from (Q25).</p>
          </section>
          <section className="card pad comes-with">
            <div className="notice-card-head">
              <h2 className="h2">Visa news</h2>
              <span className="chip chip-muted chip-sm">IVS feed</span>
            </div>
            <p className="muted small">Comes with the IVS subscription (Q24). Until then, post IVS news here with "From the IVS visa-news feed".</p>
          </section>
        </aside>
      </div>

      {editing && (
        <NoticeDrawer
          notice={editing === 'new' ? null : editing}
          departments={postable}
          departmentCode={postable.some((d) => d.code === department) ? department : (postable[0]?.code ?? '')}
          canPick={isHodOf(me, 'VISA')}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove "${removing.title}"?`}
          body="It comes off the board for everyone. It stays in the records."
          confirmLabel="Remove"
          danger
          pending={remove.isPending}
          error={errorText(remove.error)}
          onCancel={() => {
            setRemoving(null)
            remove.reset()
          }}
          onConfirm={() =>
            remove.mutate(removing.id, {
              onSuccess: () => {
                toast({ tone: 'ok', message: 'Notice removed.' })
                setRemoving(null)
              },
            })
          }
        />
      )}
    </>
  )
}

function NoticeItem({ notice, onEdit, onRemove }: { notice: Notice; onEdit: () => void; onRemove: () => void }) {
  const style = departmentStyle(notice.department.code)
  return (
    <li className="notice-item">
      <div className="notice-meta">
        <span className="chip chip-sm" style={{ background: style.tint, color: style.text }}>
          {notice.department.name}
        </span>
        <span className="chip chip-muted chip-sm">{tagLabel(notice)}</span>
        {notice.inLoginPopup && <span className="chip chip-info chip-sm">In the login popup</span>}
        <span className="muted small">{postedLine(notice)}</span>
        {notice.canChange && (
          <span className="notice-actions">
            <button type="button" className="btn btn-sm" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
              Remove
            </button>
          </span>
        )}
      </div>
      <strong className="notice-title">{notice.title}</strong>
      {notice.body && <p className="notice-body">{notice.body}</p>}
    </li>
  )
}
