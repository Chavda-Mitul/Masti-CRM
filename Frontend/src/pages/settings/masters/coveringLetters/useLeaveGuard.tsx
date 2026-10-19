import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'

/**
 * Unsaved work on a page asks before it's lost, as the checklist editor does: leaving by a link, the sidebar or
 * Back/Forward shows `dialog`, and closing the tab or reloading makes the browser ask. Going to /login (logging out, a
 * session ending) is let through. Call `release()` when a save succeeds, before the page moves on by itself.
 */
export function useLeaveGuard(dirty: boolean, lost: string) {
  const released = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !released.current && nextLocation.pathname !== currentLocation.pathname && nextLocation.pathname !== '/login',
  )

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      if (!released.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const dialog =
    blocker.state === 'blocked' ? (
      <ConfirmDialog
        title="Leave without saving?"
        body={lost}
        confirmLabel="Leave"
        danger
        pending={false}
        error={null}
        onCancel={() => blocker.reset()}
        onConfirm={() => blocker.proceed()}
      />
    ) : null

  return {
    dialog,
    release: () => {
      released.current = true
    },
  }
}
