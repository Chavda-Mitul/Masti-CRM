import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useBlocker } from 'react-router'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Keeps a drawer's typed-in work from being thrown away by accident.
 *
 * - **A click outside** closes the drawer only when the press also started outside it, so a text selection dragged past
 *   the drawer's edge doesn't count. Spread `overlayProps` on the `.overlay` element; the drawer inside needs no
 *   stopPropagation.
 * - **Escape** closes it.
 * - With unsaved changes (`dirty`), both of those ask first, and so does leaving the page: links, the sidebar,
 *   Back/Forward (useBlocker) and closing the tab or reloading (beforeunload). Going to /login (logging out, session
 *   ended) is let through.
 * - The drawer's own Cancel button is a deliberate choice, so it calls `onClose` directly without asking.
 *
 * Call `release()` when a save succeeds, before the drawer closes or the page navigates (e.g. to a new client), so the
 * guard doesn't stop the drawer's own navigation. Render `dialog` after the overlay so it sits on top.
 */
export function useDrawerGuard(dirty: boolean, onClose: () => void) {
  const released = useRef(false)
  const pressedOutside = useRef(false)
  const [asking, setAsking] = useState(false)

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !released.current && nextLocation.pathname !== currentLocation.pathname && nextLocation.pathname !== '/login',
  )

  const leaving = blocker.state === 'blocked'

  const requestClose = () => {
    if (dirty && !released.current) setAsking(true)
    else onClose()
  }
  const keepEditing = () => {
    setAsking(false)
    if (leaving) blocker.reset()
  }

  // Escape closes the drawer, or the "Discard?" question if it's showing. The latest handler, without re-adding the
  // listener on every render.
  const onEscape = useRef(requestClose)
  useEffect(() => {
    onEscape.current = asking || leaving ? keepEditing : requestClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onEscape.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      if (!released.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const overlayProps = {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      pressedOutside.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const outside = e.target === e.currentTarget && pressedOutside.current
      pressedOutside.current = false
      if (outside) requestClose()
    },
  }

  const dialog =
    asking || leaving ? (
      <ConfirmDialog
        title="Discard your changes?"
        body="What you typed in this panel hasn't been saved."
        confirmLabel="Discard"
        danger
        pending={false}
        error={null}
        onCancel={keepEditing}
        onConfirm={() => {
          setAsking(false)
          released.current = true
          if (leaving) blocker.proceed()
          else onClose()
        }}
      />
    ) : null

  return {
    overlayProps,
    dialog,
    release: () => {
      released.current = true
    },
  }
}
