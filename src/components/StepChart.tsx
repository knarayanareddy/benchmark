import React from "react";

const W = 640;
const H = 220;
const L = 56;
const R = 20;
const T = 18;
const B = 40;

/** The date as a day count, so spacing on the x axis follows the calendar. */
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

export type StepPoint = {
  date: string;
  value: number;
  conflict?: boolean;
};

/**
 * A step chart of dated values: each value holds until the next date.
 * Entries are drawn in date order; entries on the same day keep the order they were recorded in and sit at the same x.
 * Every chart has an accessible data table of its values beside/below it so meaning never relies on colour or sight alone.
 */
export function StepChart({
  title,
  points,
  yMin = 0,
  yMax = 100,
  unit = "%",
  caption,
}: {
  title: string;
  points: StepPoint[];
  yMin?: number;
  yMax?: number;
  unit?: string;
  caption?: string;
}) {
  if (!points || points.length === 0) {
    return <p className="text-xs text-stone-500">No dated history recorded.</p>;
  }

  // A stable sort: same-day entries keep the file order, which is how ACAPS recorded them.
  const pts = [...points].sort((a, b) => day(a.date) - day(b.date));
  const first = day(pts[0].date);
  const last = day(pts[pts.length - 1].date);
  const span = last - first;
  const x = (d: string) =>
    L + (span > 0 ? (day(d) - first) / span : 0.5) * (W - L - R);
  const y = (v: number) =>
    T +
    (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) *
      (H - T - B);
  const fmt = (v: number) => `${v}${unit}`;
  const sameDay = pts.map(
    (p, i) => Boolean(p.conflict) || (i > 0 && p.date === pts[i - 1].date)
  );
  const latest = pts[pts.length - 1];
  const desc =
    pts.length === 1
      ? `One recorded value: ${fmt(latest.value)} on ${latest.date}.`
      : `${pts.length} recorded values from ${pts[0].date} to ${latest.date}. Latest: ${fmt(
          latest.value
        )} on ${latest.date}.`;

  // The value holds from its date until the next one: a horizontal run at the old value, then a vertical step.
  let path = "";
  if (pts.length > 1) {
    path = `M${x(pts[0].date)} ${y(pts[0].value)}`;
    for (let i = 1; i < pts.length; i++) {
      path += ` H${x(pts[i].date)} V${y(pts[i].value)}`;
    }
  }
  const gridValues = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <figure className="space-y-2.5 rounded-xl border border-stone-200 bg-white p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        className="h-auto w-full max-w-2xl overflow-visible"
      >
        <title>{title}</title>
        <desc>{desc}</desc>
        {gridValues.map((v) => (
          <g key={v}>
            <line
              stroke="#e7e5e4"
              strokeDasharray="3 3"
              x1={L}
              x2={W - R}
              y1={y(v)}
              y2={y(v)}
            />
            <text
              fill="#57534e"
              fontSize="11"
              x={L - 8}
              y={y(v) + 4}
              textAnchor="end"
            >
              {fmt(v)}
            </text>
          </g>
        ))}
        <line
          stroke="#a8a29e"
          strokeWidth="1.25"
          x1={L}
          x2={W - R}
          y1={H - B}
          y2={H - B}
        />
        {span > 0 ? (
          <>
            <text fill="#57534e" fontSize="11" x={L} y={H - B + 18}>
              {pts[0].date}
            </text>
            <text
              fill="#57534e"
              fontSize="11"
              x={W - R}
              y={H - B + 18}
              textAnchor="end"
            >
              {latest.date}
            </text>
          </>
        ) : (
          <text
            fill="#57534e"
            fontSize="11"
            x={x(pts[0].date)}
            y={H - B + 18}
            textAnchor="middle"
          >
            {pts[0].date}
          </text>
        )}
        {path && (
          <path
            d={path}
            fill="none"
            stroke="#0f766e"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        )}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(p.date)}
            cy={y(p.value)}
            r={5}
            fill={sameDay[i] ? "#d97706" : "#0f766e"}
            stroke="#ffffff"
            strokeWidth="1.5"
          >
            <title>{`${p.date}: ${fmt(p.value)}${
              sameDay[i] ? ", same day, order as recorded" : ""
            }`}</title>
          </circle>
        ))}
      </svg>
      {caption && <figcaption className="text-xs text-stone-500">{caption}</figcaption>}
      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-xs text-slate-700"
          aria-label={`${title}: values`}
        >
          <thead>
            <tr className="border-b border-stone-200 text-stone-500">
              <th scope="col" className="py-1 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Value (analyst-recorded)
              </th>
              <th scope="col" className="py-1 font-medium">
                Note
              </th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p, i) => (
              <tr key={i} className="border-b border-stone-100 last:border-0">
                <td className="py-1 pr-3 font-mono">{p.date}</td>
                <td className="py-1 pr-3 font-semibold">{fmt(p.value)}</td>
                <td className="py-1 text-amber-800">
                  {sameDay[i] ? "same day, order as recorded" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
