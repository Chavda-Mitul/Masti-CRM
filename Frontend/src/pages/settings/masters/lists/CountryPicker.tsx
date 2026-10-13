import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

type CountryOption = { id: number; name: string; zone: string | null }

/** "France (Schengen)" */
const label = (c: CountryOption) => (c.zone ? `${c.name} (${c.zone})` : c.name)

/**
 * Several countries in a searchable multi-select (the holiday TargetPicker's look and keys), by id as strings.
 * `countries` are the ones that can be picked (the active ones); `extra` keeps countries already picked that the list no
 * longer offers (switched off since) visible, so editing never drops one silently.
 */
export function CountryPicker({
  value,
  onChange,
  countries,
  extra,
  invalid,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  countries: CountryOption[]
  extra: CountryOption[]
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const on = new Set(value)
  const toggle = (id: string) => onChange(on.has(id) ? value.filter((v) => v !== id) : [...value, id])
  const labels = new Map<string, string>()
  for (const c of countries) labels.set(String(c.id), label(c))
  for (const c of extra) labels.set(String(c.id), `${label(c)} (switched off)`)

  const q = query.trim().toLowerCase()
  const hit = (c: CountryOption) => !q || label(c).toLowerCase().includes(q)
  const shown = [...countries.filter(hit), ...extra.filter(hit)]

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && value.length > 0) {
      toggle(value.at(-1)!)
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault() // Enter would submit the drawer's form
      setOpen(true)
    }
  }

  if (countries.length === 0 && extra.length === 0) {
    return <span className="muted small">No countries set up yet (Masters → Countries).</span>
  }
  return (
    <div className="multi-select" ref={rootRef}>
      <div
        className="input multi-select-field"
        aria-invalid={invalid || undefined}
        onClick={() => {
          setOpen(true)
          searchRef.current?.focus()
        }}
      >
        {value.map((id) => (
          <span className="chip chip-info chip-sm multi-select-chip" key={id}>
            {labels.get(id) ?? id}
            <button
              type="button"
              aria-label={`Remove ${labels.get(id) ?? id}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle(id)
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={searchRef}
          className="multi-select-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onSearchKey}
          placeholder={value.length ? '' : 'Search countries'}
          aria-label="Search countries"
          aria-expanded={open}
          aria-controls={listId}
        />
      </div>
      {open && (
        <div className="multi-select-pop" id={listId} role="group" aria-label="Countries">
          {shown.map((c) => (
            <label className="check" key={c.id}>
              <input type="checkbox" checked={on.has(String(c.id))} onChange={() => toggle(String(c.id))} />
              <span>{labels.get(String(c.id))}</span>
            </label>
          ))}
          {shown.length === 0 && <span className="muted small">Nothing matches “{query.trim()}”.</span>}
        </div>
      )}
    </div>
  )
}
