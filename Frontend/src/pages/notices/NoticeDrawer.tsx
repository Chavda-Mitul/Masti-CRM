import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { FormAlert, FormField } from '../../components/FormField'
import { useDrawerGuard } from '../../components/useDrawerGuard'
import { applyServerIssues, errorText, isStale } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { CATEGORY_LABEL } from './labels'
import { useSaveNotice } from './queries'
import { noticeFormSchema, type NoticeFormValues } from './schemas'
import type { Notice, NoticeBody, NoticeCategory } from './types'

const CATEGORIES: NoticeCategory[] = ['AIRLINE', 'EMBASSY', 'HOTEL', 'GENERAL']

/** "Which one", by what the notice is about. */
const ABOUT_HINT: Record<NoticeCategory, string> = {
  AIRLINE: 'e.g. IndiGo',
  EMBASSY: 'e.g. China',
  HOTEL: 'e.g. Marriott Dubai',
  GENERAL: 'e.g. Process',
}

function formDefaults(notice: Notice | null, departmentCode: string): NoticeFormValues {
  if (!notice) return { departmentCode, category: 'GENERAL', about: '', title: '', body: '', fromIvs: false, loginPopup: false }
  return {
    departmentCode: notice.department.code,
    category: notice.category,
    about: notice.about ?? '',
    title: notice.title,
    body: notice.body ?? '',
    fromIvs: notice.source === 'IVS',
    loginPopup: notice.inLoginPopup,
  }
}

function toBody(v: NoticeFormValues): NoticeBody {
  return {
    category: v.category,
    about: v.about.trim() || null,
    title: v.title.trim(),
    body: v.body.trim() || null,
    source: v.fromIvs ? 'IVS' : 'TEAM',
    // Only a Visa notice goes in the visa team's popup (Decision 12).
    loginPopup: v.departmentCode === 'VISA' && v.loginPopup,
  }
}

/**
 * Post a notice to a department the person works in, or edit one (docs/decisions/0017-today-dashboard.md Decision 11).
 * A notice stays in its department. A save over someone else's change is refused (optimistic locking).
 */
export function NoticeDrawer({
  notice,
  departments,
  departmentCode,
  canPick,
  onClose,
}: {
  notice: Notice | null
  /** The departments this person can post to. */
  departments: { code: string; name: string }[]
  departmentCode: string
  /** The Head or the Visa HOD: may put a Visa notice in the visa team's login popup (Decision 12). */
  canPick: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const isNew = notice === null
  // The version this form was opened on (see ClientFormDrawer): a background refetch must not hide a conflict.
  const [openedAt] = useState(notice?.updatedAt)

  const form = useForm<NoticeFormValues>({ resolver: zodResolver(noticeFormSchema), defaultValues: formDefaults(notice, departmentCode) })
  const { register, handleSubmit, control, setError, formState } = form
  const { errors } = formState
  const category = useWatch({ control, name: 'category' })
  const chosenDepartment = useWatch({ control, name: 'departmentCode' })

  const save = useSaveNotice()
  const drawer = useDrawerGuard(formState.isDirty, onClose)

  const onSubmit = handleSubmit((values) => {
    const body = toBody(values)
    save.mutate(notice ? { id: notice.id, body: { ...body, updatedAt: openedAt ?? notice.updatedAt } } : { body: { ...body, departmentCode: values.departmentCode } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: isNew ? `Posted to the ${saved.department.name} board.` : 'Notice saved.' })
        drawer.release()
        onClose()
      },
      onError: (error) => {
        if (isStale(error)) return onClose()
        applyServerIssues(error, setError, ['departmentCode', 'category', 'about', 'title', 'body'])
      },
    })
  })
  const message = errorText(save.error)

  return (
    <>
      <div className="overlay" {...drawer.overlayProps}>
        <form className="drawer" onSubmit={onSubmit} noValidate>
          <div className="pad drawer-head">
            <h2 className="h2">{isNew ? 'Post a notice' : 'Edit the notice'}</h2>
            <p className="muted">{isNew ? 'Everyone in the office sees it on the board.' : `On the ${notice.department.name} board.`}</p>
          </div>

          <div className="pad drawer-body">
            {isNew && (
              <FormField label="Department" error={errors.departmentCode?.message}>
                <select className="select" {...register('departmentCode')}>
                  {departments.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}

            <span className="lbl section-lbl">About</span>
            <div className="kind-toggle" role="radiogroup" aria-label="About">
              {CATEGORIES.map((value) => (
                <label key={value} className={category === value ? 'on' : ''}>
                  <input type="radio" value={value} {...register('category')} className="sr-only" />
                  {CATEGORY_LABEL[value]}
                </label>
              ))}
            </div>

            <FormField label="Which one (optional)" error={errors.about?.message} hint="The airline, embassy or hotel; for a general notice, a word such as Process.">
              <input className="input" {...register('about')} placeholder={ABOUT_HINT[category]} />
            </FormField>

            <FormField label="Title" error={errors.title?.message}>
              <input className="input" {...register('title')} placeholder="China visa centres closed 1–7 Oct" autoFocus={isNew} />
            </FormField>

            <FormField label="Details (optional)" error={errors.body?.message}>
              <textarea className="input textarea" rows={4} {...register('body')} placeholder="Don't promise dates in this window on the phone." />
            </FormField>

            <label className="check">
              <input type="checkbox" {...register('fromIvs')} />
              From the IVS visa-news feed
            </label>
            {canPick && chosenDepartment === 'VISA' && (
              <label className="check">
                <input type="checkbox" {...register('loginPopup')} />
                Show in the visa team's login popup
              </label>
            )}

            {message && <FormAlert>{message}</FormAlert>}
          </div>

          <div className="pad drawer-foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : isNew ? 'Post' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
      {drawer.dialog}
    </>
  )
}
