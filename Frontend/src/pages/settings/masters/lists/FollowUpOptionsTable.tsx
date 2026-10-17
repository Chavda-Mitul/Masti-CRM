import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { followUpOptionFormSchema, type FollowUpOptionFormValues } from '../schemas'
import type { FollowUpOption } from '../types'
import { ListCard } from './ListCard'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

type OptionResource = 'follow-up-outcomes' | 'follow-up-next-steps' | 'processing-speeds' | 'field-fail-reasons'

const COPY: Record<OptionResource, { title: string; column: string; one: string; intro: string; placeholder: string; codeHint: string }> = {
  'follow-up-outcomes': {
    title: 'Follow-up · What happened',
    column: 'What happened',
    one: 'an outcome',
    intro: 'The first dropdown when staff log a follow-up. Only a label: picking one never changes the case.',
    placeholder: 'Spoke — documents coming',
    codeHint: 'e.g. NO_ANSWER.',
  },
  'follow-up-next-steps': {
    title: 'Follow-up · Next step',
    column: 'Next step',
    one: 'a next step',
    intro: 'The second dropdown when staff log a follow-up.',
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
 * Simple dropdown lists of a code and a name: the two follow-up dropdowns (0006 Decision 7), the processing speeds
 * on a visa quote (0009) and why a field visit fails (0015 Decision 5). No free text: reports count these.
 */
export function FollowUpOptionsTable({ resource, canEdit, showInactive }: { resource: OptionResource; canEdit: boolean; showInactive: boolean }) {
  const copy = COPY[resource]
  const list = useMasterList(resource)
  const [editing, setEditing] = useState<FollowUpOption | 'new' | null>(null)
  const rows = (list.data ?? []).filter((o) => showInactive || o.isActive)

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
                <td>{o.sortOrder}</td>
                <td>{o.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(o)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource={resource} id={o.id} name={o.name} isActive={o.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <OptionDrawer resource={resource} option={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function OptionDrawer({ resource, option, onClose }: { resource: OptionResource; option: FollowUpOption | null; onClose: () => void }) {
  const copy = COPY[resource]
  const toast = useToast()
  const save = useSaveMaster(resource)
  const { register, handleSubmit, setError, formState } = useForm<FollowUpOptionFormValues>({
    resolver: zodResolver(followUpOptionFormSchema),
    defaultValues: { code: option?.code ?? '', name: option?.name ?? '', sortOrder: option?.sortOrder ?? 0 },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = { name: v.name, sortOrder: v.sortOrder }
    save.mutate(option ? { id: option.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['code', 'name', 'sortOrder']),
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
    </MasterDrawer>
  )
}
