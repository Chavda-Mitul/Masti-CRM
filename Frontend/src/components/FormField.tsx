import type { ReactNode } from 'react'

/** A labelled input with its validation message (or a hint when there's no error). */
export function FormField({
  label,
  error,
  hint,
  children,
  wide,
}: {
  label: string
  error?: string | undefined
  hint?: ReactNode
  children: ReactNode
  /** Span both columns of a .form-grid. */
  wide?: boolean
}) {
  return (
    <label className={`field${error ? ' field-invalid' : ''}`} style={wide ? { gridColumn: '1 / -1' } : undefined}>
      {label}
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
