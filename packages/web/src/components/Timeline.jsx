import { StepChart } from './StepChart.jsx';
import '../evolution.css';

const CAPTION = 'Dates and values as recorded by ACAPS analysts. Completion rate is a judgement whose meaning has not been standardised.';
const TREND_CLASS = { Deteriorated: 'tl-bad', Improved: 'tl-good', Stable: 'tl-flat' };

/** Newest first; an update with no date (text before the first dated header) goes last. Equal dates keep the file order. */
const newestFirst = (/** @type {Array<{ date: string | null, text: string }>} */ updates) =>
  [...updates].sort((a, b) => ((b.date ?? '') < (a.date ?? '') ? -1 : (b.date ?? '') > (a.date ?? '') ? 1 : 0));

/**
 * How a risk has been recorded to change. Shows only what ACAPS recorded, with its dates: no durations or lags are computed.
 * @param {{ timeline?: any }} props
 */
export function Timeline({ timeline }) {
  if (!timeline) return null;
  const triggers = (timeline.triggers ?? []).filter((/** @type {any} */ t) => t.completion?.length || t.trend?.length);
  const updates = newestFirst(timeline.rationaleUpdates ?? []);
  return (
    <section className="tl">
      <h3>How this risk has been recorded to change</h3>
      <p className="muted tl-caption">{CAPTION}</p>
      {triggers.length === 0 && updates.length === 0 && <p>ACAPS has recorded no dated changes for this risk.</p>}
      {triggers.map((/** @type {any} */ t, i) => {
        const readings = (t.completion?.length ?? 0) + (t.trend?.length ?? 0);
        return (
          <article key={t.id ?? i} className="tl-trigger">
            <h4>{t.title}</h4>
            {t.completion?.length > 0 && <StepChart title={`Completion rate: ${t.title}`} points={t.completion} yMin={0} yMax={100} unit="%" />}
            {readings === 1 && <p className="muted">One reading, no movement to show</p>}
            {t.trend?.length > 0 && (
              <ul className="tl-trend" aria-label={`Trend: ${t.title}`}>
                {t.trend.map((/** @type {{ date: string, value: string, conflict?: boolean }} */ p, j) => (
                  <li key={j}>
                    <span className={`pill tl-pill ${TREND_CLASS[/** @type {keyof typeof TREND_CLASS} */ (p.value)] ?? ''}`}>{p.value}</span>
                    <time dateTime={p.date}>{p.date}</time>
                    {p.conflict && <span className="muted">same day, order as recorded</span>}
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
      {updates.length > 0 && (
        <>
          <h4>Rationale updates</h4>
          <ol className="tl-updates">
            {updates.map((/** @type {{ date: string | null, text: string }} */ u, i) => (
              <li key={i}>
                <time dateTime={u.date ?? undefined}>{u.date ?? 'Undated'}</time>
                <details>
                  <summary>Show this update</summary>
                  <p className="pre-wrap">{u.text}</p>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
