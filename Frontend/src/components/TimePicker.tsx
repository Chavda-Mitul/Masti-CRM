import { type CSSProperties, type KeyboardEvent, type Ref, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Column = 'hour' | 'minute' | 'half'
type Draft = { hour?: string; minute?: string; half?: string }

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const HALVES = ['AM', 'PM']

/** "15:05" → 03 / 05 / PM; "" → nothing picked yet. */
function toDraft(value: string): Draft {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return {}
  const h = Number(m[1])
  return { hour: String(h % 12 || 12).padStart(2, '0'), minute: m[2], half: h >= 12 ? 'PM' : 'AM' }
}

/** Back to "HH:mm", 24-hour, as the API takes it; null until all three are picked. */
function fromDraft(d: Draft): string | null {
  if (!d.hour || !d.minute || !d.half) return null
  const h = (Number(d.hour) % 12) + (d.half === 'PM' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${d.minute}`
}

/** "03:05 PM", with "--" for what isn't picked yet. */
const shown = (d: Draft) => `${d.hour ?? '--'}:${d.minute ?? '--'} ${d.half ?? '--'}`

/**
 * A time box: Hour, Minute and AM/PM columns that close by themselves once all three are picked (decided 21 Oct 2026).
 * Not the browser's time box: Chrome's list has no way to finish, so it stayed open after the time was chosen. A click
 * outside or Escape closes it too; what was picked by then stays. The value is "HH:mm", 24-hour, and stays "" until all
 * three are picked. The clock is Lucide's (ISC licence, lucide.dev).
 */
export function TimePicker({
  ref,
  value,
  onChange,
  label,
  invalid,
  disabled,
  style,
}: {
  /** For react-hook-form's Controller, so a failed save can focus it. */
  ref?: Ref<HTMLButtonElement>
  value: string
  onChange: (value: string) => void
  /** What the box is for, read out with the time, e.g. "Next follow-up time". */
  label: string
  invalid?: boolean
  disabled?: boolean
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>({})
  // The columns picked since it opened: all three closes it.
  const [picked, setPicked] = useState<Column[]>([])
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const setButton = useCallback(
    (el: HTMLButtonElement | null) => {
      buttonRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )

  const close = (focusBox: boolean) => {
    setOpen(false)
    if (focusBox) buttonRef.current?.focus()
  }

  const pick = (column: Column, option: string) => {
    const next = { ...draft, [column]: option }
    setDraft(next)
    const time = fromDraft(next)
    if (time !== null && time !== value) onChange(time)
    const done = picked.includes(column) ? picked : [...picked, column]
    setPicked(done)
    if (done.length === 3) close(true)
  }

  // Under the box (above it if there's no room below), on the page body so a table or card can't clip it. Each column
  // scrolls to what's picked, and the hours take the focus.
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!open || !pop) return
    const place = () => {
      const box = buttonRef.current?.getBoundingClientRect()
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
    for (const col of pop.querySelectorAll<HTMLElement>('.time-col')) {
      const on = col.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (on) col.scrollTop = on.offsetTop - (col.clientHeight - on.offsetHeight) / 2
    }
    pop.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true })
    const onScroll = (e: Event) => {
      if (!pop.contains(e.target as Node)) place()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!popRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onPopKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault() // a drawer's Escape (useDrawerGuard) leaves it alone
      close(true)
    } else if (e.key === 'Tab') {
      // Tab moves between the three columns and stays inside.
      e.preventDefault()
      const cols = [...e.currentTarget.querySelectorAll<HTMLElement>('.time-col')]
      const at = cols.findIndex((c) => c.contains(document.activeElement))
      const to = cols[(at + (e.shiftKey ? -1 : 1) + cols.length) % cols.length]
      to?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
    }
  }

  const now = open ? draft : toDraft(value)
  const empty = !now.hour && !now.minute && !now.half
  return (
    <>
      <button
        ref={setButton}
        type="button"
        className={`input time-input${empty ? ' time-input-empty' : ''}`}
        style={style}
        disabled={disabled}
        aria-label={`${label}: ${value ? shown(toDraft(value)) : 'not picked'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          setDraft(toDraft(value))
          setPicked([])
          setOpen(true)
        }}
      >
        <span>{shown(now)}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 6v6l4 2" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="time-pop" ref={popRef} role="dialog" aria-label={label} onKeyDown={onPopKey}>
            <TimeColumn name="Hour" options={HOURS} picked={draft.hour} onPick={(o) => pick('hour', o)} />
            <TimeColumn name="Minute" options={MINUTES} picked={draft.minute} onPick={(o) => pick('minute', o)} />
            <TimeColumn name="AM or PM" options={HALVES} picked={draft.half} onPick={(o) => pick('half', o)} />
          </div>,
          document.body,
        )}
    </>
  )
}

/** One column. Only its picked option (or its first) is a Tab stop; the arrow keys, Home and End move within it. */
function TimeColumn({ name, options, picked, onPick }: { name: string; options: string[]; picked: string | undefined; onPick: (option: string) => void }) {
  const stop = picked ?? options[0]
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const moves: Record<string, number | undefined> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 }
    const to = moves[e.key]
    if (to === undefined || at < 0) return
    e.preventDefault()
    buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus()
  }
  return (
    <div className="time-col" role="group" aria-label={name} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o} type="button" className="time-opt" tabIndex={o === stop ? 0 : -1} aria-pressed={o === picked} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}
