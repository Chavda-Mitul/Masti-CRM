import { useState, type ReactNode } from 'react'

interface Pending<W> {
  warning: W
  resubmit: () => void
}

/**
 * "Are you sure?" for warnings the backend lets you override, e.g. 409 DUPLICATE answered by saving again with
 * confirmDuplicates: true. `read` turns an error into the warning to show (or null if it isn't one); `render` draws it.
 * Pass a save's error to `intercept` with a function that saves again with the override. If it was such a warning,
 * the modal opens and `intercept` returns true. Render `modal` after the form's overlay, not inside it.
 *
 *   save.mutate(body, { onError: (err) => guard.intercept(err, () => save.mutate({ ...body, confirmDuplicates: true }, handlers)) })
 */
export function useRetryGuard<W>(
  read: (error: unknown) => W | null,
  render: (warning: W, actions: { cancel: () => void; confirm: () => void }) => ReactNode,
) {
  const [pending, setPending] = useState<Pending<W> | null>(null)

  const intercept = (error: unknown, resubmit: () => void): boolean => {
    const warning = read(error)
    if (warning === null) return false
    setPending({ warning, resubmit })
    return true
  }

  const modal = pending
    ? render(pending.warning, {
        cancel: () => setPending(null),
        confirm: () => {
          setPending(null)
          pending.resubmit()
        },
      })
    : null

  return { intercept, modal }
}
