import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * A popup drawn on the page body next to the button that opened it, so a table or card can't clip it: under the button
 * (above it when there's no room below), kept inside the window as the page scrolls or resizes. A click outside both
 * closes it. Returns the ref for the popup's element. Used by TimePicker and InfoButton; Escape is theirs to handle.
 */
export function usePopup(open: boolean, setOpen: (open: boolean) => void, anchor: RefObject<HTMLElement | null>) {
  const popup = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const pop = popup.current
    if (!open || !pop) return
    const place = () => {
      const box = anchor.current?.getBoundingClientRect()
      if (!box) return
      const gap = 6
      const edge = 8
      const below = box.bottom + gap
      const above = box.top - gap - pop.offsetHeight
      const top = below + pop.offsetHeight > window.innerHeight - edge && above >= edge ? above : below
      pop.style.top = `${top}px`
      pop.style.left = `${Math.max(edge, Math.min(box.left, window.innerWidth - pop.offsetWidth - edge))}px`
    }
    place()
    const onScroll = (e: Event) => {
      if (!pop.contains(e.target as Node)) place()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!popup.current?.contains(target) && !anchor.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, setOpen, anchor])

  return popup
}
