import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { countryKey, embassyKey } from '../forms'
import type { HolidayTargetOptions } from '../types'

const FIXED = new Set(['ALL_EMBASSIES', 'MASTI_OFFICE'])

/**
 * "Applies to": all embassies, our office, a country's embassy & visa centres, or one embassy. Several can be ticked
 * (the demo's "All embassies in India · our office"). Countries and embassies sit in a searchable multi-select, since
 * that list grows with the Countries master. `extra` keeps targets the options no longer list (a country or embassy
 * switched off since) visible, so editing a holiday never drops one silently.
 */
export function TargetPicker({
  value,
  onChange,
  options,
  extra,
}: {
  value: string[]
  onChange: (keys: string[]) => void
  options: HolidayTargetOptions
  extra: { key: string; label: string }[]
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
  const toggle = (key: string) => onChange(on.has(key) ? value.filter((k) => k !== key) : [...value, key])
  const box = (key: string, label: string, hint?: string) => (
    <label className="check" key={key}>
      <input type="checkbox" checked={on.has(key)} onChange={() => toggle(key)} />
      <span>
        {label}
        {hint && <span className="hint"> · {hint}</span>}
      </span>
    </label>
  )

  const labels = new Map<string, string>()
  for (const country of options.countries) {
    labels.set(countryKey(country.id), country.label)
    for (const e of country.embassies) labels.set(embassyKey(e.id), `${e.name} · ${e.city}`)
  }
  for (const t of extra) labels.set(t.key, `${t.label} (switched off)`)
  const picked = value.filter((k) => !FIXED.has(k))

  const q = query.trim().toLowerCase()
  const hit = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q))
  const countries = options.countries.flatMap((country) => {
    const countryHit = hit(country.label, country.name, country.code)
    const embassies = countryHit ? country.embassies : country.embassies.filter((e) => hit(e.name, e.city, e.code))
    return countryHit || embassies.length > 0 ? [{ ...country, embassies }] : []
  })
  const switchedOff = extra.filter((t) => hit(t.label))

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && picked.length > 0) {
      toggle(picked.at(-1)!)
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault() // Enter would submit the drawer's form
      setOpen(true)
    }
  }

  return (
    <div className="target-picker">
      {box('ALL_EMBASSIES', 'All embassies in India')}
      {box('MASTI_OFFICE', 'Our office, collections & deliveries')}

      <span className="lbl section-lbl">Or one country, or one embassy</span>
      {on.has('ALL_EMBASSIES') && <span className="hint">All embassies is ticked, so these are already covered.</span>}
      {options.countries.length === 0 && extra.length === 0 ? (
        <span className="muted small">No countries set up yet (Masters → Countries).</span>
      ) : (
        <div className="multi-select" ref={rootRef}>
          <div
            className="input multi-select-field"
            onClick={() => {
              setOpen(true)
              searchRef.current?.focus()
            }}
          >
            {picked.map((key) => (
              <span className="chip chip-info chip-sm multi-select-chip" key={key}>
                {labels.get(key) ?? key}
                <button
                  type="button"
                  aria-label={`Remove ${labels.get(key) ?? key}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(key)
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
              placeholder={picked.length ? '' : 'Search countries or embassies'}
              aria-label="Search countries or embassies"
              aria-expanded={open}
              aria-controls={listId}
            />
          </div>
          {open && (
            <div className="multi-select-pop" id={listId} role="group" aria-label="Countries and embassies">
              {countries.map((country) => (
                <div key={country.id} className="target-country">
                  {box(countryKey(country.id), country.label)}
                  {country.embassies.length > 0 && (
                    <div className="target-embassies">{country.embassies.map((e) => box(embassyKey(e.id), e.name, e.city))}</div>
                  )}
                </div>
              ))}
              {switchedOff.map((t) => box(t.key, t.label, 'switched off'))}
              {countries.length === 0 && switchedOff.length === 0 && <span className="muted small">Nothing matches “{query.trim()}”.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
