import { Controller, useWatch, type UseFormReturn } from 'react-hook-form'
import { FormField, RequiredMark } from '../../../../components/FormField'
import { CountryPicker } from '../lists/CountryPicker'
import { useMasterList } from '../queries'
import type { CoveringLetterFormValues } from '../schemas'
import type { CoveringLetterSummary } from '../types'
import { PARTY_LABEL } from './labels'

/**
 * A covering letter's details (docs/decisions/0019-covering-letters.md): its name, and which cases it fits: the visa
 * type, the countries and who travels. For a new letter's page and the Edit details drawer, inside a .form-grid. A
 * country or visa type the letter already has stays listed when switched off since; one being added must be active.
 */
export function LetterDetailsFields({ form, letter }: { form: UseFormReturn<CoveringLetterFormValues>; letter: CoveringLetterSummary | null }) {
  const { register, control, formState } = form
  const { errors } = formState
  const countries = useMasterList('countries')
  const visaTypes = useMasterList('visa-types')
  const party = useWatch({ control, name: 'party' })

  const activeCountries = (countries.data ?? []).filter((c) => c.isActive)
  const extra = (letter?.countries ?? []).filter((c) => !activeCountries.some((a) => a.id === c.id))
  const types = (visaTypes.data ?? []).filter((t) => t.isActive || t.id === letter?.visaType.id)

  return (
    <>
      <FormField label="Name" error={errors.name?.message} hint="What staff pick it by on a case. It isn’t printed." required wide>
        <input className="input" {...register('name')} placeholder="Schengen · tourist · family" autoFocus={!letter} aria-required />
      </FormField>

      <FormField label="Visa type" error={errors.visaTypeId?.message} required>
        {/* Controlled, so the saved choice shows even when the list arrives after the drawer opens. */}
        <Controller
          control={control}
          name="visaTypeId"
          render={({ field }) => (
            <select className="select" {...field} disabled={!visaTypes.data} aria-required>
              <option value="">{visaTypes.data ? 'Pick a visa type' : 'Loading…'}</option>
              {types.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                  {t.isActive ? '' : ' (switched off)'}
                </option>
              ))}
            </select>
          )}
        />
      </FormField>

      {/* Not a FormField: that is a <label>, and the choice holds its own inputs. */}
      <div className={`field${errors.party ? ' field-invalid' : ''}`}>
        <span>
          Who travels
          <RequiredMark />
        </span>
        <div className="seg-sm" role="radiogroup" aria-label="Who travels">
          {(['ONE', 'SEVERAL'] as const).map((p) => (
            <label key={p} className={party === p ? 'on' : ''}>
              <input type="radio" value={p} {...register('party')} className="sr-only" />
              {PARTY_LABEL[p]}
            </label>
          ))}
        </div>
        {errors.party?.message ? (
          <span className="field-error" role="alert">
            {errors.party.message}
          </span>
        ) : (
          <span className="hint">A case with this many travellers is offered it.</span>
        )}
      </div>

      <div className={`field${errors.countryIds ? ' field-invalid' : ''}`} style={{ gridColumn: '1 / -1' }}>
        <span>
          Countries
          <RequiredMark />
        </span>
        <Controller
          control={control}
          name="countryIds"
          render={({ field }) => (
            <CountryPicker value={field.value} onChange={field.onChange} countries={activeCountries} extra={extra} invalid={!!errors.countryIds} />
          )}
        />
        {errors.countryIds?.message ? (
          <span className="field-error" role="alert">
            {errors.countryIds.message}
          </span>
        ) : (
          <span className="hint">For a Schengen letter, pick each Schengen country it’s for.</span>
        )}
      </div>

      <FormField label="Order in lists" error={errors.sortOrder?.message} hint="When a case fits two letters, the lower number is picked first.">
        <input className="input" type="number" min={0} {...register('sortOrder', { valueAsNumber: true })} />
      </FormField>
    </>
  )
}
