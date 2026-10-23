import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormField, RequiredMark } from '../../../../components/FormField'
import { applyServerIssues } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useMasterList, useSaveMaster } from '../queries'
import { documentFormSchema, type DocumentFormValues } from '../schemas'
import type { DocumentMaster } from '../types'
import { ListCard } from './ListCard'
import { numberOrNull, orNull, uploadRulesLabel } from '../forms'
import { MasterDrawer, ToggleActiveButton } from './MasterDrawer'

/**
 * Every document a checklist can ask for. A document still on an active checklist can't be switched off (the server
 * says which checklists). Renaming one doesn't change cases already open: intake copies the names.
 */
export function DocumentsTable({ canEdit, showInactive }: { canEdit: boolean; showInactive: boolean }) {
  const list = useMasterList('documents')
  const [editing, setEditing] = useState<DocumentMaster | 'new' | null>(null)
  const rows = (list.data ?? []).filter((d) => showInactive || d.isActive)

  return (
    <>
      <ListCard
        title="Documents"
        count={rows.length}
        addLabel="Add a document"
        canEdit={canEdit}
        onAdd={() => setEditing('new')}
        query={list}
        empty="No documents yet."
      >
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Document</th>
              <th>Shown to the client</th>
              <th>Upload rules</th>
              <th>Scan warning</th>
              <th>Status</th>
              {canEdit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={d.isActive ? undefined : 'row-off'}>
                <td className="mono">{d.code}</td>
                <td style={{ fontWeight: 700 }}>{d.name}</td>
                <td className="muted">{d.detail ?? '—'}</td>
                <td>{uploadRulesLabel(d)}</td>
                <td>{d.warnIfNoScan ? 'On' : <span className="muted">Off</span>}</td>
                <td>{d.isActive ? <span className="chip chip-ok chip-sm">Active</span> : <span className="chip chip-muted chip-sm">Switched off</span>}</td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(d)}>
                        Edit
                      </button>
                      <ToggleActiveButton resource="documents" id={d.id} name={d.name} isActive={d.isActive} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      {editing && <DocumentDrawer document={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function DocumentDrawer({ document, onClose }: { document: DocumentMaster | null; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveMaster('documents')
  const { register, handleSubmit, setError, formState } = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      code: document?.code ?? '',
      name: document?.name ?? '',
      detail: document?.detail ?? '',
      sortOrder: document?.sortOrder ?? 0,
      warnIfNoScan: document?.warnIfNoScan ?? false,
      fileTypes: document?.fileTypes ?? ['PDF', 'JPG', 'PNG'],
      minSizeMb: document?.minSizeMb?.toString() ?? '',
      maxSizeMb: document?.maxSizeMb?.toString() ?? '',
      photoWidthMm: document?.photoWidthMm?.toString() ?? '',
      photoHeightMm: document?.photoHeightMm?.toString() ?? '',
    },
  })
  const { errors } = formState

  const onSubmit = handleSubmit((v) => {
    const body = {
      name: v.name,
      detail: orNull(v.detail),
      sortOrder: v.sortOrder,
      warnIfNoScan: v.warnIfNoScan,
      fileTypes: v.fileTypes,
      minSizeMb: numberOrNull(v.minSizeMb),
      maxSizeMb: numberOrNull(v.maxSizeMb),
      photoWidthMm: numberOrNull(v.photoWidthMm),
      photoHeightMm: numberOrNull(v.photoHeightMm),
    }
    save.mutate(document ? { id: document.id, body } : { body: { ...body, code: v.code } }, {
      onSuccess: (saved) => {
        toast({ tone: 'ok', message: `${saved.name} saved.` })
        onClose()
      },
      onError: (err) =>
        applyServerIssues(err, setError, [
          'code',
          'name',
          'detail',
          'sortOrder',
          'warnIfNoScan',
          'fileTypes',
          'minSizeMb',
          'maxSizeMb',
          'photoWidthMm',
          'photoHeightMm',
        ]),
    })
  })

  return (
    <MasterDrawer
      title={document ? `Edit ${document.name}` : 'Add a document'}
      intro="Then add it to the checklists that need it."
      submitLabel={document ? 'Save changes' : 'Add document'}
      pending={save.isPending}
      error={save.error}
      dirty={formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormField label="Code" error={errors.code?.message} hint={document ? 'Codes never change.' : 'e.g. BANK_STATEMENT_6M.'}>
        <input className="input mono upper" {...register('code')} readOnly={!!document} autoFocus={!document} />
      </FormField>
      <FormField label="Order in lists" error={errors.sortOrder?.message}>
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
      <FormField label="Document" error={errors.name?.message} wide>
        <input className="input" {...register('name')} placeholder="Bank statement, last 6 months" />
      </FormField>
      <FormField label="Shown to the client (optional)" error={errors.detail?.message} wide hint="Extra detail in the WhatsApp list.">
        <input className="input" {...register('detail')} placeholder="35×45 mm, white background" />
      </FormField>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label className="check">
          <input type="checkbox" {...register('warnIfNoScan')} />
          Warn if no scan is saved
        </label>
        <span className="hint">The case shows “Scan not saved” when this paper is ticked but no copy is kept for the next trip.</span>
      </div>

      <span className="lbl section-lbl" style={{ gridColumn: '1 / -1' }}>
        Upload rules
      </span>
      {/* Not a FormField: that is a <label>, and the group holds its own inputs. */}
      <div className={`field${errors.fileTypes ? ' field-invalid' : ''}`} style={{ gridColumn: '1 / -1' }}>
        <span>
          File type
          <RequiredMark />
        </span>
        <div className="check-picks" role="group" aria-label="File type">
          {(['PDF', 'JPG', 'PNG'] as const).map((type) => (
            <label className="check" key={type}>
              <input type="checkbox" value={type} {...register('fileTypes')} />
              {type}
            </label>
          ))}
        </div>
        {errors.fileTypes ? (
          <span className="field-error" role="alert">
            {errors.fileTypes.message}
          </span>
        ) : (
          <span className="hint">A scan of this paper must be one of these, or it isn’t saved.</span>
        )}
      </div>
      <FormField label="Min size (MB, optional)" error={errors.minSizeMb?.message} hint="Blank: no minimum.">
        <input className="input" type="number" min={0.01} step={0.01} inputMode="decimal" {...register('minSizeMb')} placeholder="e.g. 0.01" />
      </FormField>
      <FormField label="Max size (MB, optional)" error={errors.maxSizeMb?.message} hint="Blank: the usual limit.">
        <input className="input" type="number" min={0.01} step={0.01} inputMode="decimal" {...register('maxSizeMb')} placeholder="e.g. 0.3" />
      </FormField>
      <FormField label="Photo width (mm, optional)" error={errors.photoWidthMm?.message} hint="Fill in both, or leave both blank.">
        <input className="input" type="number" min={10} step={1} inputMode="numeric" {...register('photoWidthMm')} placeholder="e.g. 35" />
      </FormField>
      <FormField label="Photo height (mm, optional)" error={errors.photoHeightMm?.message} hint="Only the shape is checked, on JPG and PNG.">
        <input className="input" type="number" min={10} step={1} inputMode="numeric" {...register('photoHeightMm')} placeholder="e.g. 45" />
      </FormField>
    </MasterDrawer>
  )
}
