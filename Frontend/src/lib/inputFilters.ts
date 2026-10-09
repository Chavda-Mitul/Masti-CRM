import type { UseFormRegisterReturn } from 'react-hook-form'

// Characters that can never be valid in a field are dropped as they are typed or pasted, so a mistake can't get in
// unnoticed. The form schema still checks the whole value on save (and the backend checks it again).

/** Mobile numbers: digits, spaces, "+" and "-" ("+91 98250-41234"). */
export const mobileChars = (value: string) => value.replace(/[^\d\s+-]/g, '')

/** PIN codes. */
export const digitsOnly = (value: string) => value.replace(/\D/g, '')

/** PAN, GSTIN and passport numbers: letters and digits, in capitals, as they are stored. */
export const codeChars = (value: string) => value.replace(/[^a-z0-9]/gi, '').toUpperCase()

/**
 * A registered input whose value passes through `clean` on every change. The caret stays where it was,
 * less any characters dropped before it.
 */
export function filtered<TName extends string>(field: UseFormRegisterReturn<TName>, clean: (value: string) => string): UseFormRegisterReturn<TName> {
  return {
    ...field,
    onChange: (event) => {
      const input = event.target as HTMLInputElement
      const cleaned = clean(input.value)
      if (cleaned !== input.value) {
        const caret = clean(input.value.slice(0, input.selectionStart ?? input.value.length)).length
        input.value = cleaned
        input.setSelectionRange(caret, caret)
      }
      return field.onChange(event)
    },
  }
}
