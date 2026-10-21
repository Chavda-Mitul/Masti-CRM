import { useRef } from 'react'
import { useController, type UseFormReturn } from 'react-hook-form'
import { FormField, RequiredMark } from '../../../../components/FormField'
import { LetterPaper } from '../../../../components/LetterPaper'
import { istToday } from '../../../../lib/format'
import { LETTER_BLANKS, MAX_LETTER_CHARS, normaliseWording, wordingProblem, type WordingFormValues } from '../schemas'
import { EXAMPLE_TRAVELLERS, EXAMPLE_VALUES } from './labels'

/**
 * Writing a covering letter's wording (docs/decisions/0019-covering-letters.md): the text and its blanks (a click puts one
 * where the cursor is), the day it's used from, and a preview filled in with an example family. For a new letter's page
 * and "Change the wording".
 */
export function WordingFields({ form }: { form: UseFormReturn<WordingFormValues> }) {
  const { field, fieldState } = useController({ control: form.control, name: 'body' })
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  const dayError = form.formState.errors.effectiveFrom?.message
  const length = normaliseWording(field.value).length
  // Shown as you type; saving refuses it.
  const problem = wordingProblem(field.value)

  /**
   * Puts a blank where the cursor is (over a selection). {travellers} and {purpose} get a line of their own: one prints
   * as a table, the other as the AI's paragraph.
   */
  const insert = (token: string) => {
    const el = textarea.current
    const value = field.value
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    let piece = `{${token}}`
    if (token === 'travellers' || token === 'purpose') {
      if (start > 0 && value[start - 1] !== '\n') piece = `\n${piece}`
      if (value[end] !== '\n') piece = `${piece}\n`
    }
    field.onChange(value.slice(0, start) + piece + value.slice(end))
    const caret = start + piece.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="wording-fields">
      <div className="wording-write">
        <label className={`field${fieldState.error ? ' field-invalid' : ''}`}>
          <span>
            The letter
            <RequiredMark />
          </span>
          <textarea
            ref={(el) => {
              textarea.current = el
              field.ref(el)
            }}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            className="input textarea wording-text"
            rows={18}
            aria-required
          />
          {fieldState.error ? (
            <span className="field-error" role="alert">
              {fieldState.error.message}
            </span>
          ) : problem ? (
            <span className="hint wording-warn">{problem}</span>
          ) : (
            <span className="hint">
              A blank line starts a new paragraph. {length} of {MAX_LETTER_CHARS} characters.
            </span>
          )}
        </label>

        <FormField
          label="Use from"
          error={dayError}
          hint="From this day, new letters use this wording. Today puts it in use at once; the one before stays on record."
          required
          className="wording-day"
        >
          <input className="input" type="date" min={istToday()} {...form.register('effectiveFrom')} aria-required />
        </FormField>
      </div>

      <div className="wording-blanks" aria-label="Blanks">
        <span className="lbl">Blanks</span>
        <p className="muted small">Click one to put it where the cursor is. Each case fills in its own.</p>
        {LETTER_BLANKS.map((b) => (
          <button key={b.token} type="button" className="wording-blank" onClick={() => insert(b.token)}>
            <span className="letter-blank">{`{${b.token}}`}</span>
            <span className="small">{b.label}</span>
          </button>
        ))}
      </div>

      <div className="wording-preview">
        <span className="lbl">Preview, filled in for an example family</span>
        <LetterPaper body={field.value} values={EXAMPLE_VALUES} travellers={EXAMPLE_TRAVELLERS} />
      </div>
    </div>
  )
}
