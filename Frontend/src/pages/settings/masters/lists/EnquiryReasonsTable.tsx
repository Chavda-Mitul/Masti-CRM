import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { canEditTagged } from '../../../../auth/permissions'
import type { User } from '../../../../auth/types'
import { useMe } from '../../../../auth/useAuth'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { startingDepartments } from '../departmentTags'
import { useMasterList, useSaveMaster } from '../queries'
import { enquiryReasonFormSchema, type EnquiryReasonFormValues } from '../schemas'
import type { EnquiryReason, EnquiryReasonKind } from '../types'
import { DepartmentsField, DepartmentTags, TaggedEditors } from './DepartmentPicker'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

const KIND_LABEL: Record<EnquiryReasonKind, string> = { POSTPONE: 'Postpone', CANCEL: 'Cancel' }

/**
 * Why a case was postponed or cancelled (0006 Decision 7), in the departments each is tagged with (0018). "Fixed
 * reasons only — no free text anywhere." A reason is changed only by the Head or an HOD of every department it is for.
 */
export function EnquiryReasonsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const { data: me } = useMe()
  const list = useMasterList('enquiry-reasons')
  const [editing, setEditing] = useState<EnquiryReason | 'new' | null>(null)
  const rows = (list.data ?? []).filter((r) => showInactive || r.isActive)

  return (
    <>
      <ListCard
        title="Postpone & cancel reasons"
        count={rows.length}
        addLabel="Add a reason"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No reasons yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Reason</th>
              <th>Used for</th>
              <th>Departments</th>
              <th>Order</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.isActive ? undefined : 'row-off'}>
                <td className="mono">{r.code}</td>
                <td style={{ fontWeight: 700 }}>{r.name}</td>
                <td>{KIND_LABEL[r.kind]}</td>
                <td>
                  <DepartmentTags codes={r.departments} />
                </td>
                <td>{r.sortOrder}</td>
                <td>{r.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      {me && canEditTagged(me, r.departments) ? (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>
                            Edit
                          </button>
                          <ToggleActiveButton resource="enquiry-reasons" id={r.id} name={r.name} isActive={r.isActive} />
                        </>
                      ) : (
                        <TaggedEditors codes={r.departments} />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && me && <ReasonDrawer me={me} reason={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ReasonDrawer({ me, reason, onClose }: { me: User; reason: EnquiryReason | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('enquiry-reasons')
  const { register, handleSubmit, setError, formState, control } = useForm<EnquiryReasonFormValues>({
    resolver: zodResolver(enquiryReasonFormSchema),
    defaultValues: {
      code: reason?.code ?? '',
      name: reason?.name ?? '',
      sortOrder: reason?.sortOrder ?? 0,
      kind: reason?.kind ?? 'CANCEL',
      departments: reason?.departments ?? startingDepartments(me),
    },
  })
  const { errors } = formState
  const kind = useWatch({ control, name: 'kind' })

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder, departments: v.departments }
    save.mutate(reason ? { id: reason.id, body } : { body: { ...body, code: v.code, kind: v.kind } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder', 'kind', 'departments']),
    })
  })

  return (
    <MasterDrawer
      title={reason ? `Edit ${reason.name}` : 'Add a reason'}
      intro="Staff pick it when they postpone or cancel a case. Reports count cases by these."
      submitLabel={reason ? 'Save changes' : 'Add reason'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <span className="lbl">Used for</span>
        {reason ? (
          <span>
            {KIND_LABEL[reason.kind]} <span className="hint">· set when the reason was added</span>
          </span>
        ) : (
          <div className="kind-toggle" role="radiogroup" aria-label="Used for">
            {(['POSTPONE', 'CANCEL'] as const).map((k) => (
              <label key={k} className={kind === k ? 'on' : ''}>
                <input type="radio" value={k} {...register('kind')} className="sr-only" />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
        )}
      </div>
      <FormField label="Code" error={errors.code?.message} hint={reason ? 'Codes never change.' : 'e.g. VISA_REFUSED_BEFORE.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!reason} autoFocus={!reason} />
      </FormField>
      <FormField label="Reason" error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder="Travel dates moved" />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
      <Controller
        control={control}
        name="departments"
        render={({ field }) => <DepartmentsField me={me} value={field.value} onChange={field.onChange} error={errors.departments?.message} />}
      />
    </MasterDrawer>
  )
}
