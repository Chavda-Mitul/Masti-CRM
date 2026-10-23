import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { canEditVisaMasters, canViewVisaMasters } from '../../../../auth/permissions'
import { useMe } from '../../../../auth/useAuth'
import { FormField } from '../../../../components/FormField'
import { InfoButton } from '../../../../components/InfoButton'
import { RefreshFailed } from '../../../../components/RefreshFailed'
import { applyServerIssues, errorText, isStale } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import type { ConsentFieldKind } from '../../../enquiries/types'
import { ListCard } from '../lists/ListCard'
import { MasterDrawer } from '../lists/MasterDrawer'
import { useConsentFields, useOrderConsentFields, useSaveConsentField } from '../queries'
import { consentFieldFormSchema, MAX_CONSENT_FIELD_LABEL, type ConsentFieldFormValues } from '../schemas'
import type { ConsentFieldRow } from '../types'

/** What each kind of field takes, as staff will type it. */
const KINDS: Record<ConsentFieldKind, { label: string; hint: string }> = {
  TEXT: { label: 'Text', hint: 'One line, up to 100 characters: a name, a degree, an institute.' },
  LONG_TEXT: { label: 'Long text', hint: 'A few lines, up to 300 characters: an address.' },
  DATE: { label: 'Date', hint: 'A day, never in the future: a birthday, an anniversary.' },
  NUMBER: { label: 'Number', hint: 'Whole digits: a pass-out year, an income in rupees.' },
  LINK: { label: 'Web link', hint: 'A web address: an Instagram or LinkedIn page.' },
}

/** Why a fixed field keeps its name and stays on the form. */
const FIXED_NOTE: Record<NonNullable<ConsentFieldRow['fixed']>, string> = {
  DATE_OF_BIRTH: 'Fixed: a person’s age comes from it, so it’s always needed.',
  HOME_ADDRESS: 'Fixed: the covering letter prints it.',
  OFFICE_ADDRESS: 'Fixed: the covering letter prints it.',
}

/**
 * Settings → Masters → Consent form fields (docs/decisions/0022-consent-form.md amendment 1, change request 18): what
 * staff ask each traveller for on the consent form. The Visa HOD or the Head adds, renames, reorders and switches off
 * fields; Visa staff read them. Three fields are fixed, because other screens read them.
 */
export function ConsentFieldsPage() {
  const { data: me } = useMe()
  const visa = me ? canViewVisaMasters(me) : false
  const canEdit = me ? canEditVisaMasters(me) : false
  const fields = useConsentFields(visa)
  const order = useOrderConsentFields()
  const toast = useToast()
  const [editing, setEditing] = useState<ConsentFieldRow | 'new' | null>(null)

  if (!visa) {
    return (
      <div className="card pad" style={{ maxWidth: 560 }}>
        <h1 className="h2">Consent form fields</h1>
        <p className="muted">The consent form belongs to the Visa department. Ask the Head for Visa access to see it.</p>
      </div>
    )
  }

  const rows = fields.data ?? []
  const move = (index: number, by: -1 | 1) => {
    const ids = rows.map((f) => f.id)
    ;[ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!]
    order.mutate(ids, {
      onError: (err) => {
        if (!isStale(err)) toast({ tone: 'bad', message: errorText(err) ?? 'Could not move it.' })
      },
    })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/settings/masters" className="back-link">
            ‹ Masters
          </Link>
          <h1 className="h1">
            Consent form fields{' '}
            <InfoButton topic="Consent form fields">
              <dl className="info-list">
                <div>
                  <dt>Who fills them</dt>
                  <dd>Staff, from each traveller’s consent card on the case, by asking the client. The client only reads them and taps I agree.</dd>
                </div>
                <div>
                  <dt>A new field</dt>
                  <dd>It’s on the form from now on. People who already agreed aren’t asked again; staff can fill it in for them later.</dd>
                </div>
                <div>
                  <dt>Switched off</dt>
                  <dd>It leaves the form. Answers already given are kept, and come back if you switch it on again.</dd>
                </div>
                <div>
                  <dt>What it takes</dt>
                  <dd>Can’t change once added. To change it, switch the field off and add a new one.</dd>
                </div>
              </dl>
            </InfoButton>
          </h1>
          <p>
            What staff ask each traveller for on the consent &amp; liability form, in this order.
            {!canEdit && ' You can look, but only the Head and the Visa HOD can change these.'}
          </p>
        </div>
      </div>

      <RefreshFailed query={fields} what="the fields" />
      <ListCard
        title="Fields"
        count={rows.length}
        addLabel="Add a field"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={fields}
        empty="No fields yet."
      >
        <table className="table">
          <thead>
            <tr>
              {canEdit && <th aria-label="Order" />}
              <th>Field</th>
              <th>Takes</th>
              <th>Needed</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => (
              <tr key={f.id} className={f.isActive ? undefined : 'row-off'}>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Move ${f.label} up`}
                        disabled={i === 0 || order.isPending}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Move ${f.label} down`}
                        disabled={i === rows.length - 1 || order.isPending}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                )}
                <td>
                  <strong>{f.label}</strong>
                  {f.fixed && <div className="muted small">{FIXED_NOTE[f.fixed]}</div>}
                </td>
                <td>{KINDS[f.kind].label}</td>
                <td>{f.required ? <span className="chip chip-warn chip-sm">Required</span> : <span className="muted">Optional</span>}</td>
                <td>
                  {f.isActive ? <span className="chip chip-ok chip-sm">On the form</span> : <span className="chip chip-muted chip-sm">Switched off</span>}
                </td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(f)}>
                        Edit
                      </button>
                      {!f.fixed && <SwitchButton field={f} />}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <FieldDrawer field={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Switches a field off (it leaves the form; its answers stay) or back on. */
function SwitchButton({ field }: { field: ConsentFieldRow }) {
  const toast = useToast()
  const save = useSaveConsentField()
  const toggle = () =>
    save.mutate(
      { id: field.id, body: { isActive: !field.isActive } },
      {
        onSuccess: () => toast({ tone: 'ok', message: field.isActive ? `${field.label} is off the form.` : `${field.label} is back on the form.` }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Could not change it.' }),
      },
    )
  return (
    <button type="button" className={field.isActive ? 'btn btn-sm btn-danger' : 'btn btn-sm'} onClick={toggle} disabled={save.isPending}>
      {field.isActive ? 'Switch off' : 'Switch on'}
    </button>
  )
}

function FieldDrawer({ field, onClose }: { field: ConsentFieldRow | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveConsentField()
  const { register, handleSubmit, setError, control, formState } = useForm<ConsentFieldFormValues>({
    resolver: zodResolver(consentFieldFormSchema),
    defaultValues: { label: field?.label ?? '', kind: field?.kind ?? 'TEXT', required: field?.required ?? false },
  })
  const { errors } = formState
  const kind = useWatch({ control, name: 'kind' })
  const birth = field?.fixed === 'DATE_OF_BIRTH'

  const onSubmit = handleSubmit((v) => {
    const body = !field ? v : field.fixed ? { required: v.required } : { label: v.label, required: v.required }
    save.mutate(field ? { id: field.id, body } : { body }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: field ? `${saved.label} saved.` : `${saved.label} is on the form.` })
        onClose()
      },
      onError: (err) => applyServerIssues(err, setError, ['label', 'kind', 'required']),
    })
  })

  return (
    <MasterDrawer
      title={field ? `Edit ${field.label}` : 'Add a field'}
      intro={field ? 'Changes show on the form from now on. Consents already given keep what they showed.' : 'It goes at the end of the form; move it with the arrows.'}
      submitLabel={field ? 'Save changes' : 'Add field'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Name on the form" required error={errors.label?.message} hint={field?.fixed ? FIXED_NOTE[field.fixed] : 'e.g. Twitter / X.'} wide>
        <input className="input" maxLength={MAX_CONSENT_FIELD_LABEL} {...register('label')} readOnly={!!field?.fixed} autoFocus={!field} />
      </FormField>
      {/* Once added, the kind is shown, not a disabled input: the form would drop a disabled input's value. */}
      <FormField
        label="What it takes"
        error={errors.kind?.message}
        hint={field ? `${KINDS[kind].hint} It can’t change once added.` : KINDS[kind].hint}
        wide
      >
        {field ? (
          <input className="input" value={KINDS[field.kind].label} readOnly />
        ) : (
          <select className="select" {...register('kind')}>
            {Object.entries(KINDS).map(([value, k]) => (
              <option key={value} value={value}>
                {k.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label className="check">
          {birth ? <input type="checkbox" checked disabled readOnly /> : <input type="checkbox" {...register('required')} />}
          Required: staff can’t save the form without it
        </label>
        {birth && <span className="hint">Always needed: it tells us who is a child.</span>}
      </div>
    </MasterDrawer>
  )
}
