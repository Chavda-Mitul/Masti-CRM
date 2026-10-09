import { useRetryGuard } from '../../lib/useRetryGuard'
import { readDuplicates } from './apiErrors'
import { DuplicateWarningModal } from './DuplicateWarningModal'

/**
 * The confirmDuplicates flow for clients and members. Pass a save's error to `intercept` with a function that saves
 * again with confirmDuplicates: true. If the error was a 409 DUPLICATE, the warning opens and `intercept` returns true.
 * Render `modal` somewhere in the form.
 *
 *   save.mutate(body, { onError: (err) => guard.intercept(err, () => save.mutate({ ...body, confirmDuplicates: true }, handlers)) })
 */
export function useDuplicateGuard() {
  return useRetryGuard(readDuplicates, (found, { cancel, confirm }) => (
    <DuplicateWarningModal message={found.message} duplicates={found.duplicates} onCancel={cancel} onConfirm={confirm} />
  ))
}
