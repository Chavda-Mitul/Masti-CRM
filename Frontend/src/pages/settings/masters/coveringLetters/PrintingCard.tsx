import { useState, type FormEvent } from 'react'
import { FormField } from '../../../../components/FormField'
import { errorBody, errorText } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { useLetterheadSetting, useSaveLetterheadSetting } from '../queries'

/**
 * How covering letters print (docs/decisions/0019-covering-letters.md Decision 11): on A4, with blank space at the top of
 * the first page for the client's letterhead. The Visa HOD or the Head changes it; the next print uses it.
 */
export function PrintingCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const setting = useLetterheadSetting()
  const save = useSaveLetterheadSetting()
  // What's typed; null shows the saved value.
  const [draft, setDraft] = useState<string | null>(null)
  const saved = setting.data?.letterheadMm
  const value = draft ?? (saved === undefined ? '' : String(saved))
  const mm = Number(value)
  const invalid = value.trim() === '' || !Number.isInteger(mm) || mm < 0 || mm > 120

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (invalid) return
    save.mutate(
      { letterheadMm: mm },
      {
        onSuccess: () => {
          setDraft(null)
          toast({ tone: 'ok', message: `Letters now leave ${mm} mm for the letterhead.` })
        },
      },
    )
  }

  const serverError = errorBody(save.error)?.issues?.coveringLetter?.[0] ?? errorText(save.error)
  return (
    <section className="card pad letters-printing">
      <h2 className="h2">Printing</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Letters print on A4. The first page leaves this much blank at the top for the client’s letterhead; “Plain paper” on the
        print page leaves it out.
      </p>
      {setting.isError ? (
        <div className="alert alert-bad">{errorText(setting.error)}</div>
      ) : canEdit ? (
        <form className="letters-printing-form" onSubmit={onSubmit} noValidate>
          <FormField
            label="Space at the top for the letterhead (0–120 mm)"
            error={draft !== null && invalid ? 'Whole millimetres, 0 to 120.' : (serverError ?? undefined)}
          >
            <input
              className="input"
              type="number"
              min={0}
              max={120}
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!setting.data}
            />
          </FormField>
          <button type="submit" className="btn btn-sm btn-primary" disabled={draft === null || invalid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </form>
      ) : (
        <div className="kv-line">
          <span>Space at the top for the letterhead</span>
          <strong>{saved === undefined ? '…' : `${saved} mm`}</strong>
        </div>
      )}
    </section>
  )
}
