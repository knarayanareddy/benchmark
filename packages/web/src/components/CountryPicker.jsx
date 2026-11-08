import { useId, useState } from 'react';
import { countryName, searchCountries } from '@benchmark/core/onboarding';
import '../chips.css';

/**
 * Searchable country chips. Chosen countries sit in their own row above the results, so a search can never hide
 * something the person has already picked. Chips are labelled by country name; the ISO code is only the title.
 * @param {{ value: string[], onChange: (v: string[]) => void, max: number }} props
 */
export function CountryPicker({ value, onChange, max }) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const countId = useId();
  const chosenId = useId();
  const full = value.length >= max;
  const matches = searchCountries(query.trim()).map((c) => c.iso);
  const results = matches.filter((iso) => !value.includes(iso));

  const remove = (iso) => onChange(value.filter((v) => v !== iso));
  const add = (iso) => {
    if (!full) onChange([...value, iso]);
  };

  return (
    <div className="country-picker">
      <label htmlFor={inputId}>Search countries</label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        value={query}
        aria-describedby={countId}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p id={countId} className="chips-note" aria-live="polite">{`${value.length} of ${max} chosen`}</p>

      {value.length > 0 && (
        <>
          <p id={chosenId} className="chips-label">Chosen</p>
          <div className="chips" role="group" aria-labelledby={chosenId}>
            {value.map((iso) => (
              <button key={iso} type="button" className="chip" aria-pressed="true" title={iso} onClick={() => remove(iso)}>
                {countryName(iso)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="country-list" role="region" aria-label="Countries" tabIndex={0}>
        {query.trim() && matches.length === 0 ? (
          <p className="muted">{`No country matches “${query.trim()}”.`}</p>
        ) : (
          <div className="chips">
            {results.map((iso) => (
              <button key={iso} type="button" className="chip" aria-pressed="false" title={iso} disabled={full} onClick={() => add(iso)}>
                {countryName(iso)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
