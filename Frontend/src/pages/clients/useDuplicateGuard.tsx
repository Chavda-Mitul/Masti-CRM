import { useState } from 'react'
import { readDuplicates } from './apiErrors'
import { DuplicateWarningModal } from './DuplicateWarningModal'
import type { Duplicate } from './types'

interface Pending {
  message: string
  duplicates: Duplicate[]
  resubmit: () => void
}

/**
 * The confirmDuplicates flow. Pass a save's error to `intercept` with a function that saves again with
 * confirmDuplicates: true. If the error was a 409 DUPLICATE, the warning opens and `intercept` returns true.
 * Render `modal` somewhere in the form.
 *
 *   save.mutate(body, { onError: (err) => guard.intercept(err, () => save.mutate({ ...body, confirmDuplicates: true }, handlers)) })
 */
export function useDuplicateGuard() {
  const [pending, setPending] = useState<Pending | null>(null)

  const intercept = (error: unknown, resubmit: () => void): boolean => {
    const found = readDuplicates(error)
    if (!found) return false
    setPending({ ...found, resubmit })
    return true
  }

  const modal = pending ? (
    <DuplicateWarningModal
      message={pending.message}
      duplicates={pending.duplicates}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        setPending(null)
        pending.resubmit()
      }}
    />
  ) : null

  return { intercept, modal }
}
