import '../evolution.css';

const W = 640;
const H = 260;
const L = 56;
const R = 20;
const T = 18;
const B = 44;

/** The date as a day count, so spacing on the x axis follows the calendar. */
const day = (/** @type {string} */ d) => Date.parse(`${d}T00:00:00Z`);

/**
 * A step chart of dated values: each value holds until the next date. Entries are drawn in date order; entries on the same
 * day keep the order they were recorded in and sit at the same x. Every chart has a table of its values beside it.
 * @param {{ title: string, points: Array<{ date: string, value: number }>, yMin?: number, yMax?: number, unit?: string, caption?: string }} props
 */
export function StepChart({ title, points, yMin = 0, yMax = 100, unit = '%', caption }) {
  if (!points || points.length === 0) return <p className="muted">No dated history recorded.</p>;

  // A stable sort: same-day entries keep the file order, which is how ACAPS recorded them.
  const pts = [...points].sort((a, b) => day(a.date) - day(b.date));
  const first = day(pts[0].date);
  const last = day(pts[pts.length - 1].date);
  const span = last - first;
  const x = (/** @type {string} */ d) => L + (span > 0 ? (day(d) - first) / span : 0.5) * (W - L - R);
  const y = (/** @type {number} */ v) => T + (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * (H - T - B);
  const fmt = (/** @type {number} */ v) => `${v}${unit}`;
  const sameDay = pts.map((p, i) => i > 0 && p.date === pts[i - 1].date);
  const latest = pts[pts.length - 1];
  const desc = pts.length === 1
    ? `One recorded value: ${fmt(latest.value)} on ${latest.date}.`
    : `${pts.length} recorded values from ${pts[0].date} to ${latest.date}. Latest: ${fmt(latest.value)} on ${latest.date}.`;

  // The value holds from its date until the next one: a horizontal run at the old value, then a vertical step.
  let path = '';
  if (pts.length > 1) {
    path = `M${x(pts[0].date)} ${y(pts[0].value)}`;
    for (let i = 1; i < pts.length; i++) path += ` H${x(pts[i].date)} V${y(pts[i].value)}`;
  }
  const gridValues = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <figure className="sc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="sc-svg">
        <title>{title}</title>
        <desc>{desc}</desc>
        {gridValues.map((v) => (
          <g key={v}>
            <line className="sc-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="sc-label" x={L - 8} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        <line className="sc-axis" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        {span > 0
          ? (
            <>
              <text className="sc-label" x={L} y={H - B + 18}>{pts[0].date}</text>
              <text className="sc-label" x={W - R} y={H - B + 18} textAnchor="end">{latest.date}</text>
            </>
          )
          : <text className="sc-label" x={x(pts[0].date)} y={H - B + 18} textAnchor="middle">{pts[0].date}</text>}
        {path && <path className="sc-line" d={path} />}
        {pts.map((p, i) => (
          <circle key={i} className="sc-dot" cx={x(p.date)} cy={y(p.value)} r={4.5}>
            <title>{`${p.date}: ${fmt(p.value)}${sameDay[i] ? ', same day, order as recorded' : ''}`}</title>
          </circle>
        ))}
      </svg>
      {caption && <figcaption className="muted">{caption}</figcaption>}
      <table className="stack sc-table" aria-label={`${title}: values`}>
        <thead><tr><th scope="col">Date</th><th scope="col">Value</th><th scope="col">Note</th></tr></thead>
        <tbody>
          {pts.map((p, i) => (
            <tr key={i}>
              <td>{p.date}</td>
              <td>{fmt(p.value)}</td>
              <td>{sameDay[i] ? 'same day, order as recorded' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
