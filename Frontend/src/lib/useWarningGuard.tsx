import { WarningModal } from '../components/WarningModal'
import { readSaveWarnings } from './apiErrors'
import { useRetryGuard } from './useRetryGuard'

/**
 * The confirmWarnings flow (Backend/src/lib/warnings.ts). Pass a save's error to `intercept` with a function that saves
 * again with confirmWarnings: true. If the error was a 409 WARNING, "Check before saving" opens and `intercept` returns
 * true. Render `modal` after the dialog's overlay.
 *
 *   save.mutate(body, { onError: (err) => guard.intercept(err, () => save.mutate({ ...body, confirmWarnings: true }, handlers)) })
 */
export function useWarningGuard() {
  return useRetryGuard(readSaveWarnings, (warnings, { cancel, confirm }) => (
    <WarningModal warnings={warnings} onCancel={cancel} onConfirm={confirm} />
  ))
}
