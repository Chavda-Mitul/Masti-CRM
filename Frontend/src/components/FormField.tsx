import type { ReactNode } from 'react'

/** A labelled input with its validation message (or a hint when there's no error). */
export function FormField({
  label,
  error,
  hint,
  children,
  wide,
  required,
}: {
  label: string
  error?: string | undefined
  hint?: ReactNode
  children: ReactNode
  /** Span both columns of a .form-grid. */
  wide?: boolean
  /** Shows a red * after the label. The form's own validation is what enforces it. */
  required?: boolean
}) {
  return (
    <label className={`field${error ? ' field-invalid' : ''}`} style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <span>
        {label}
        {required && <RequiredMark />}
      </span>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </label>
  )
}

/** The * after a required field's label. Hidden from screen readers; inputs carry aria-required instead. */
export function RequiredMark() {
  return (
    <span className="req" aria-hidden="true">
      {' *'}
    </span>
  )
}
