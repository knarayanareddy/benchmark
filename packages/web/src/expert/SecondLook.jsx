/** Both reasons lists use this one component, so the two sides look exactly alike. @param {{ title: string, items: string[] }} props */
function Reasons({ title, items }) {
  return (
    <div>
      <h5>{title}</h5>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

/**
 * The optional background shown in Round 2. It says nothing about which version this person was given.
 * @param {{ look: any }} props
 */
export function SecondLook({ look }) {
  if (look.kind !== 'balanced' && look.kind !== 'acaps_view') {
    return <div className="msg err" role="alert">This background could not be shown.</div>;
  }
  return (
    <section>
      <h4>Background</h4>
      {look.kind === 'balanced'
        ? (
          <>
            <Reasons title="Reasons it could be more likely" items={look.higher ?? []} />
            <Reasons title="Reasons it could be less likely" items={look.lower ?? []} />
          </>
        )
        : (
          <>
            <h5>ACAPS&apos;s analysis</h5>
            <p className="pre-wrap">{look.acapsReasoning}</p>
            <h5>Sources</h5>
            <ul>
              {(look.sources ?? []).map((s, i) => (
                <li key={i}>
                  {s.url.startsWith('https://')
                    ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
                    : s.label}
                </li>
              ))}
            </ul>
          </>
        )}
      <p className="muted">Shown to help you check your thinking. You do not have to change your answer.</p>
    </section>
  );
}
