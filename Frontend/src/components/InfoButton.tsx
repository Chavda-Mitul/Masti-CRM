import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopup } from './usePopup'

/**
 * An ⓘ button that opens a short explanation in a small box next to it (decided 21 Oct 2026). A click outside or Escape
 * closes it. Keep it out of a <label>: the label would open the box instead of focusing its field. The icon is Lucide's
 * info (ISC licence, lucide.dev).
 */
export function InfoButton({ topic, children }: { topic: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = usePopup(open, setOpen, buttonRef)

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault() // a drawer's Escape (useDrawerGuard) leaves it alone
      setOpen(false)
      buttonRef.current?.focus()
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="info-btn"
        aria-label={`What is “${topic}”?`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={onKey}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open &&
        createPortal(
          // tabIndex so a click inside keeps Escape here
          <div className="info-pop" ref={popRef} role="dialog" aria-label={topic} tabIndex={-1} onKeyDown={onKey}>
            <strong className="info-pop-title">{topic}</strong>
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
