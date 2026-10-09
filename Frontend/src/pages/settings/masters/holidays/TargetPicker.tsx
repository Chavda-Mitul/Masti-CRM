import { countryKey, embassyKey } from '../forms'
import type { HolidayTargetOptions } from '../types'

/**
 * "Applies to": all embassies, our office, a country's embassy & visa centres, or one embassy. Several can be ticked
 * (the demo's "All embassies in India · our office"). `extra` keeps targets the options no longer list (a country or
 * embassy switched off since) visible, so editing a holiday never drops one silently.
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
  const allEmbassies = on.has('ALL_EMBASSIES')

  return (
    <div className="target-picker">
      {box('ALL_EMBASSIES', 'All embassies in India')}
      {box('MASTI_OFFICE', 'Our office, collections & deliveries')}

      <span className="lbl section-lbl">Or one country, or one embassy</span>
      {allEmbassies && <span className="hint">All embassies is ticked, so these are already covered.</span>}
      {options.countries.length === 0 && <span className="muted small">No countries set up yet (Masters → Countries).</span>}
      {options.countries.map((country) => (
        <div key={country.id} className="target-country">
          {box(countryKey(country.id), country.label)}
          {country.embassies.length > 0 && (
            <div className="target-embassies">{country.embassies.map((e) => box(embassyKey(e.id), e.name, e.city))}</div>
          )}
        </div>
      ))}
      {extra.map((t) => box(t.key, t.label, 'switched off'))}
    </div>
  )
}
