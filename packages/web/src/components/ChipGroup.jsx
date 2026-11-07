import { useId } from 'react';
import '../chips.css';

/**
 * A labelled set of toggle chips. Single mode: `value` is one option's value, and choosing the chosen chip again
 * clears it (''). Multiple mode: `value` is an array, and `max` caps how many can be chosen; the other chips are
 * disabled once the cap is reached.
 * @param {{ label: string, options: { value: string, label: string, hint?: string }[], value: string | string[], onChange: (v: any) => void, multiple?: boolean, max?: number, describedBy?: string }} props
 */
export function ChipGroup({ label, options, value, onChange, multiple = false, max, describedBy }) {
  const noteId = useId();
  const chosen = multiple ? /** @type {string[]} */ (value) : [];
  const full = multiple && max !== undefined && chosen.length >= max;
  const describedIds = [describedBy, multiple && max !== undefined ? noteId : undefined].filter(Boolean).join(' ') || undefined;

  const toggle = (option, on) => {
    if (!multiple) return onChange(on ? '' : option.value);
    if (on) return onChange(chosen.filter((v) => v !== option.value));
    if (full) return;
    onChange([...chosen, option.value]);
  };

  return (
    <>
      <div className="chips" role="group" aria-label={label} aria-describedby={describedIds}>
        {options.map((option) => {
          const on = multiple ? chosen.includes(option.value) : value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className="chip"
              aria-pressed={on}
              title={option.hint}
              disabled={!on && full}
              onClick={() => toggle(option, on)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {multiple && max !== undefined && <p id={noteId} className="chips-note">You can choose up to {max}.</p>}
    </>
  );
}
