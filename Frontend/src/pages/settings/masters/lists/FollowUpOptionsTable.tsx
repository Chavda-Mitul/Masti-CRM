import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { canEditTagged } from '../../../../auth/permissions'
import type { User } from '../../../../auth/types'
import { useMe } from '../../../../auth/useAuth'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { startingDepartments } from '../departmentTags'
import { useMasterList, useSaveMaster } from '../queries'
import { followUpOptionFormSchema, NORMAL_URGENCY, taggedOptionFormSchema, type FollowUpOptionFormValues } from '../schemas'
import type { FollowUpOption } from '../types'
import { DepartmentsField, DepartmentTags, TaggedEditors } from './DepartmentPicker'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

type OptionResource = 'follow-up-outcomes' | 'follow-up-next-steps' | 'processing-speeds' | 'urgency-levels' | 'field-fail-reasons'

/** The follow-up dropdowns are tagged with the departments they show in (0018); the other lists aren't. */
const TAGGED: OptionResource[] = ['follow-up-outcomes', 'follow-up-next-steps']

/** A row of either kind: the follow-up ones carry their departments. */
type OptionRow = FollowUpOption & { departments?: string[] }

const COPY: Record<OptionResource, { title: string; column: string; one: string; intro: string; placeholder: string; codeHint: string }> = {
  'follow-up-outcomes': {
    title: 'Follow-up · What happened',
    column: 'What happened',
    one: 'an outcome',
    intro: 'The first dropdown when staff log a follow-up, in the departments ticked below. Only a label: picking one never changes the case.',
    placeholder: 'Spoke — documents coming',
    codeHint: 'e.g. NO_ANSWER.',
  },
  'follow-up-next-steps': {
    title: 'Follow-up · Next step',
    column: 'Next step',
    one: 'a next step',
    intro: 'The second dropdown when staff log a follow-up, in the departments ticked below.',
    placeholder: 'Call again',
    codeHint: 'e.g. CALL_AGAIN.',
  },
  'processing-speeds': {
    title: 'Processing speeds',
    column: 'Processing speed',
    one: 'a processing speed',
    intro: 'How fast the embassy processes the application, picked on the case’s quote and printed on the invoice line.',
    placeholder: 'Express',
    codeHint: 'e.g. EXPRESS.',
  },
  'urgency-levels': {
    title: 'Urgency levels',
    column: 'Level',
    one: 'a level',
    intro:
      'How urgent a visa enquiry is, picked on New enquiry and changed on the case. Every enquiry starts on Normal (code NORMAL), which can be renamed but never switched off. Every other level counts as urgent and shows as a red tag.',
    placeholder: 'Very urgent',
    codeHint: 'e.g. VERY_URGENT.',
  },
  'field-fail-reasons': {
    title: 'Visit fail reasons',
    column: 'Reason',
    one: 'a reason',
    intro: 'What the collection and delivery boy picks when he couldn’t complete a stop. The case comes back to the office, due now.',
    placeholder: 'Client not home',
    codeHint: 'e.g. CLIENT_NOT_HOME.',
  },
}

/**
 * Simple dropdown lists of a code and a name: the two follow-up dropdowns (0006 Decision 7, tagged by department in
 * 0018), the processing speeds on a visa quote (0009), how urgent a visa enquiry is (0003 amendment 1; Normal is never
 * switched off) and why a field visit fails (0015 Decision 5). No free text: reports count these. A follow-up value is
 * changed only by the Head or an HOD of every department it is for.
 */
export function FollowUpOptionsTable({ resource, canEdit, showInactive }: { resource: OptionResource; canEdit: boolean; showInactive: boolean }) {
  const copy = COPY[resource]
  const tagged = TAGGED.includes(resource)
  const { data: me } = useMe()
  const list = useMasterList(resource)
  const [editing, setEditing] = useState<OptionRow | 'new' | null>(null)
  const rows: OptionRow[] = (list.data ?? []).filter((o) => showInactive || o.isActive)
  const canChange = (o: OptionRow) => !tagged || (!!me && canEditTagged(me, o.departments ?? []))
  // Every enquiry starts on Normal, so it is never switched off (the backend refuses too).
  const canSwitchOff = (o: OptionRow) => !(resource === 'urgency-levels' && o.code === NORMAL_URGENCY)

  return (
    <>
      <ListCard
        title={copy.title}
        count={rows.length}
        addLabel={`Add ${copy.one}`}
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="Nothing here yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>{copy.column}</th>
              {tagged && <th>Departments</th>}
              <th>Order</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={o.isActive ? undefined : 'row-off'}>
                <td className="mono">{o.code}</td>
                <td style={{ fontWeight: 700 }}>{o.name}</td>
                {tagged && (
                  <td>
                    <DepartmentTags codes={o.departments ?? []} />
                  </td>
                )}
                <td>{o.sortOrder}</td>
                <td>{o.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      {canChange(o) ? (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(o)}>
                            Edit
                          </button>
                          {canSwitchOff(o) && <ToggleActiveButton resource={resource} id={o.id} name={o.name} isActive={o.isActive} />}
                        </>
                      ) : (
                        <TaggedEditors codes={o.departments ?? []} />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && me && (
        <OptionDrawer resource={resource} me={me} option={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function OptionDrawer({ resource, me, option, onClose }: { resource: OptionResource; me: User; option: OptionRow | null; onClose: () => void }) {
  const copy = COPY[resource]
  const tagged = TAGGED.includes(resource)
  const toast = useToast()
  const save = useSaveMaster(resource)
  const { register, handleSubmit, setError, formState, control } = useForm<FollowUpOptionFormValues>({
    resolver: zodResolver(tagged ? taggedOptionFormSchema : followUpOptionFormSchema),
    defaultValues: {
      code: option?.code ?? '',
      name: option?.name ?? '',
      sortOrder: option?.sortOrder ?? 0,
      departments: option ? (option.departments ?? []) : startingDepartments(me),
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder, ...(tagged ? { departments: v.departments } : {}) }
    save.mutate(option ? { id: option.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder', 'departments']),
    })
  })

  return (
    <MasterDrawer
      title={option ? `Edit ${option.name}` : `Add ${copy.one}`}
      intro={copy.intro}
      submitLabel={option ? 'Save changes' : 'Add'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={option ? 'Codes never change.' : copy.codeHint}>
        <input className="input mono upper" {...register('code')} readOnly={!!option} autoFocus={!option} />
      </FormField>
      <FormField label={copy.column} error={errors.name?.message}>
        <input className="input" {...register('name')} placeholder={copy.placeholder} />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
      {tagged && (
        <Controller
          control={control}
          name="departments"
          render={({ field }) => <DepartmentsField me={me} value={field.value} onChange={field.onChange} error={errors.departments?.message} />}
        />
      )}
    </MasterDrawer>
  )
}
