import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useBlocker, useParams } from 'react-router'
import { canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { api } from '../../../../lib/api'
import { errorText, isStale } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { masterKeys, useChecklist, useMasterList, useOfferings, useReplaceChecklist, useSaveOffering } from '../queries'
import { checklistFormSchema, MAX_CHECKLIST_ITEMS, type ChecklistFormValues, type ChecklistLineValues } from '../schemas'
import type { Checklist, DocumentMaster, DocumentRequirement, TravellerGroup } from '../types'

const REQUIREMENTS: { value: DocumentRequirement; label: string }[] = [
  { value: 'ORIGINAL', label: 'Original' },
  { value: 'XEROX_OK', label: 'Xerox is fine' },
  { value: 'ARRANGED_BY_US', label: 'Arranged by us' },
]

const FOR_WHOM: { value: TravellerGroup; label: string }[] = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'ADULTS', label: 'Adults only' },
  { value: 'CHILDREN', label: 'Children only' },
]

type View = 'ALL' | 'ADULTS' | 'CHILDREN'

/** Does a line reach this kind of traveller? */
const reaches = (appliesTo: TravellerGroup, view: View) => view === 'ALL' || appliesTo === 'ALL' || appliesTo === view

const toLine = (item: Checklist['items'][number]): ChecklistLineValues => ({
  documentId: item.document.id,
  requirement: item.requirement,
  appliesTo: item.appliesTo,
  quantity: item.quantity,
  note: item.note ?? '',
})

/** The editor for one country × visa type checklist. Loads it, then hands it to the form (remounted after each save). */
export function ChecklistEditorPage() {
  const offeringId = Number(useParams().offeringId)
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false
  const checklist = useChecklist(offeringId, visa && Number.isInteger(offeringId))
  const documents = useMasterList('documents', visa)

  if (!visa) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <h1 className="h2">Document checklist</h1>
        <p className="muted">The checklists belong to the Visa department. Ask the Head for Visa access to see them.</p>
      </div>
    )
  }
  if (checklist.isError || documents.isError) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <Link to="/settings/masters/checklists" className="back-link">
          ‹ Checklists
        </Link>
        <div className="alert alert-bad">{errorText(checklist.error ?? documents.error)}</div>
      </div>
    )
  }
  if (!checklist.data || !documents.data) return <div className="muted">Loading…</div>

  return (
    <ChecklistEditor
      // A new version (after a save, or "Reload" after a conflict) starts a fresh draft.
      key={checklist.data.offering.updatedAt}
      checklist={checklist.data}
      documents={documents.data}
      canEdit={me ? canEditVisaMasters(me) : false}
    />
  )
}

function ChecklistEditor({ checklist, documents, canEdit }: { checklist: Checklist; documents: DocumentMaster[]; canEdit: boolean }) {
  const offeringId = checklist.offering.id
  const toast = useToast()
  const queryClient = useQueryClient()
  const offerings = useOfferings()
  const replace = useReplaceChecklist(offeringId)
  const setActive = useSaveOffering()

  const form = useForm<ChecklistFormValues>({
    resolver: zodResolver(checklistFormSchema),
    defaultValues: { items: checklist.items.map(toLine) },
  })
  const { control, register, handleSubmit, formState, reset } = form
  const { fields, append, remove, move, replace: replaceLines } = useFieldArray({ control, name: 'items' })
  const lines = useWatch({ control, name: 'items' }) ?? []
  const dirty = formState.isDirty

  const [view, setView] = useState<View>('ALL')
  const [stale, setStale] = useState(false)

  // Any navigation away while there are unsaved changes asks first: sidebar, tabs, links, Back/Forward.
  // Same-page changes (the query string) and going to the login page (logging out, session ended) are let through.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && nextLocation.pathname !== currentLocation.pathname && nextLocation.pathname !== '/login',
  )

  // Closing the tab, reloading or typing a new address isn't a router navigation: the browser asks instead.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Documents for the dropdowns: the active ones, plus any on this list that were switched off since.
  const byId = new Map(documents.map((d) => [d.id, d]))
  for (const item of checklist.items) if (!byId.has(item.document.id)) byId.set(item.document.id, { ...item.document, sortOrder: 0 })
  const onList = new Set(lines.map((l) => l.documentId))
  const choosable = (current: number) => [...byId.values()].filter((d) => d.isActive || d.id === current)
  const addable = documents.filter((d) => d.isActive && !onList.has(d.id))

  const adults = lines.filter((l) => reaches(l.appliesTo, 'ADULTS')).length
  const children = lines.filter((l) => reaches(l.appliesTo, 'CHILDREN')).length

  const add = (documentId: number) => append({ documentId, requirement: 'ORIGINAL', appliesTo: 'ALL', quantity: 1, note: '' })

  /** Loads another visa's checklist into this draft (switched-off documents are left out: they can't be added). */
  const copyFrom = async (otherId: number) => {
    const other = await queryClient.fetchQuery({
      queryKey: masterKeys.checklist(otherId),
      queryFn: () => api<Checklist>(`/masters/visa-offerings/${otherId}/checklist`),
    })
    const usable = other.items.filter((i) => i.document.isActive || onList.has(i.document.id))
    replaceLines(usable.map(toLine))
    const dropped = other.items.length - usable.length
    toast({
      tone: dropped ? 'warn' : 'info',
      message: `Copied ${usable.length} documents from ${other.offering.label}${dropped ? ` (${dropped} switched-off left out)` : ''}. Check them, then save.`,
    })
  }

  const onSave = handleSubmit((values) =>
    replace.mutate(
      {
        updatedAt: checklist.offering.updatedAt,
        items: values.items.map((l) => ({ ...l, note: l.note.trim() || null })),
      },
      {
        onSuccess: () => toast({ tone: 'ok', message: `${checklist.offering.label} checklist saved. Open cases keep the list they started with.` }),
        onError: (err) => {
          if (isStale(err)) setStale(true)
        },
      },
    ),
  )

  const reload = () => void queryClient.invalidateQueries({ queryKey: masterKeys.checklist(offeringId) })
  const listError = formState.errors.items?.message ?? formState.errors.items?.root?.message
  const message = isStale(replace.error) ? null : errorText(replace.error)

  return (
    <form onSubmit={onSave} noValidate className="checklist-editor">
      <div className="page-head">
        <div>
          <Link to="/settings/masters/checklists" className="back-link">
            ‹ Checklists
          </Link>
          <h1 className="h1">{checklist.offering.label}</h1>
          <p>
            {checklist.offering.isActive ? 'Offered at intake.' : 'Switched off: not offered at intake.'} Changes apply to new cases
            only; open cases keep the list they started with.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className={checklist.offering.isActive ? 'btn btn-danger' : 'btn'}
            disabled={dirty || setActive.isPending}
            title={dirty ? 'Save or discard your changes first.' : undefined}
            onClick={() =>
              setActive.mutate(
                { id: offeringId, body: { isActive: !checklist.offering.isActive } },
                { onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not change it.' }) },
              )
            }
          >
            {checklist.offering.isActive ? 'Switch off this visa' : 'Switch on this visa'}
          </button>
        )}
      </div>

      {stale && (
        <div className="alert alert-warn stale-bar" role="alert">
          Someone else changed this checklist after you opened it, so it wasn’t saved. Reload to see their version (your changes
          here will be lost), then make yours again.
          <button type="button" className="btn btn-sm" onClick={reload}>
            Reload
          </button>
        </div>
      )}

      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="pad checklist-tools">
          <div className="kind-toggle" role="tablist" aria-label="Show the list for">
            {(
              [
                ['ALL', `Everything (${lines.length})`],
                ['ADULTS', `Adults (${adults})`],
                ['CHILDREN', `Children (${children})`],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? 'on' : ''} onClick={() => setView(value)}>
                {label}
              </button>
            ))}
          </div>
          {canEdit && (
            <select
              className="select"
              value=""
              aria-label="Copy from another checklist"
              style={{ width: 260 }}
              onChange={(e) => e.target.value && void copyFrom(Number(e.target.value))}
            >
              <option value="">Copy from another visa…</option>
              {offerings.data
                ?.filter((o) => o.id !== offeringId && o.checklistCount)
                .map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {o.label} ({o.checklistCount})
                  </option>
                ))}
            </select>
          )}
        </div>

        {fields.length === 0 ? (
          <div className="pad muted">No documents yet. {canEdit && 'Add the first one below.'}</div>
        ) : (
          <fieldset disabled={!canEdit} className="plain-fieldset">
            <table className="table checklist-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Document</th>
                  <th>We need</th>
                  <th>For</th>
                  <th style={{ width: 80 }}>How many</th>
                  <th>Note for the client</th>
                  {canEdit && <th aria-label="Order and remove" />}
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => {
                  const line = lines[i]
                  if (line && !reaches(line.appliesTo, view)) return null
                  const err = formState.errors.items?.[i]
                  const doc = line ? byId.get(line.documentId) : undefined
                  return (
                    <tr key={field.id}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        <select className="select" {...register(`items.${i}.documentId`, { valueAsNumber: true })} aria-label="Document">
                          {choosable(line?.documentId ?? 0).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                              {d.isActive ? '' : ' (switched off)'}
                            </option>
                          ))}
                        </select>
                        {doc?.detail && <div className="hint">{doc.detail}</div>}
                        {err?.documentId && <div className="field-error">{err.documentId.message}</div>}
                      </td>
                      <td>
                        <div className="seg-sm" role="radiogroup" aria-label="We need">
                          {REQUIREMENTS.map((r) => (
                            <label key={r.value} className={line?.requirement === r.value ? 'on' : ''}>
                              <input type="radio" value={r.value} {...register(`items.${i}.requirement`)} className="sr-only" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td>
                        <select className="select" {...register(`items.${i}.appliesTo`)} aria-label="For">
                          {FOR_WHOM.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input className="input" type="number" min={1} max={20} {...register(`items.${i}.quantity`, { valueAsNumber: true })} aria-label="How many" />
                        {err?.quantity && <div className="field-error">{err.quantity.message}</div>}
                      </td>
                      <td>
                        <input className="input" {...register(`items.${i}.note`)} placeholder="optional" aria-label="Note for the client" />
                        {err?.note && <div className="field-error">{err.note.message}</div>}
                      </td>
                      {canEdit && (
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn-sm" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up">
                              ↑
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => move(i, i + 1)} disabled={i === fields.length - 1} aria-label="Move down">
                              ↓
                            </button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(i)} aria-label="Remove">
                              ✕
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </fieldset>
        )}

        {canEdit && (
          <div className="pad checklist-add">
            <select
              className="select"
              value=""
              aria-label="Add a document"
              style={{ maxWidth: 360 }}
              disabled={addable.length === 0 || fields.length >= MAX_CHECKLIST_ITEMS}
              onChange={(e) => e.target.value && add(Number(e.target.value))}
            >
              <option value="">{addable.length ? '+ Add a document…' : 'Every active document is on the list'}</option>
              {addable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span className="hint">A missing document can be added under Masters → Lists → Documents.</span>
          </div>
        )}
      </section>

      {canEdit && (dirty || message || listError) && (
        <div className="save-bar">
          <span className="save-bar-text">
            {listError ? <span className="field-error">{listError}</span> : message ? <span className="field-error">{message}</span> : 'Unsaved changes'}
          </span>
          <button type="button" className="btn" onClick={() => reset()} disabled={replace.isPending || !dirty}>
            Discard
          </button>
          <button type="submit" className="btn btn-primary" disabled={replace.isPending || stale || !dirty}>
            {replace.isPending ? 'Saving…' : 'Save checklist'}
          </button>
        </div>
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Leave without saving?"
          body="Your changes to this checklist will be lost."
          confirmLabel="Leave"
          danger
          pending={false}
          error={null}
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      )}
    </form>
  )
}
