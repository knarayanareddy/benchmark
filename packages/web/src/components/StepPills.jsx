import '../chips.css';

/**
 * Progress through a numbered wizard. `current` is 1-based: steps before it are done, it is the current step,
 * steps after it are still to do. "Done" is also said in words, so it is not conveyed by colour alone.
 * @param {{ steps: string[], current: number }} props
 */
export function StepPills({ steps, current }) {
  return (
    <ol className="steps" aria-label="Progress">
      {steps.map((name, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'now' : 'todo';
        return (
          <li key={name} className={state} aria-current={state === 'now' ? 'step' : undefined}>
            {n}. {name}
            {state === 'done' && <span className="visually-hidden">, completed</span>}
          </li>
        );
      })}
    </ol>
  );
}
