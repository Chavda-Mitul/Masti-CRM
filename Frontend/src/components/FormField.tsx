import { useEffect, useRef, type ReactNode } from 'react'

/** A labelled input with its validation message (or a hint when there's no error). */
export function FormField({
  label,
  error,
  hint,
  children,
  wide,
  required,
  className,
}: {
  label: string
  error?: string | undefined
  hint?: ReactNode
  children: ReactNode
  /** Span both columns of a .form-grid. */
  wide?: boolean
  /** Shows a red * after the label. The form's own validation is what enforces it. */
  required?: boolean
  /** Extra classes on the field, e.g. its width in a 12-column grid. */
  className?: string
}) {
  return (
    <label className={`field${error ? ' field-invalid' : ''}${className ? ` ${className}` : ''}`} style={wide ? { gridColumn: '1 / -1' } : undefined}>
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

/**
 * The form's own error, under its fields, scrolled into view when it appears. In a drawer it sits at the end of the
 * scrolling body, so a refused save used to look as if the button did nothing (the 21 Oct 2026 role test). A save
 * clears the error while it runs, so each refused save shows it again.
 */
export function FormAlert({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])
  return (
    <div ref={ref} className="alert alert-bad" role="alert">
      {children}
    </div>
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
