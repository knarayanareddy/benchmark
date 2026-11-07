/**
 * Dependency-free SVG charts (power-spec §D, WP7). Every chart carries the simulation banner as visible <text>, in
 * <title> and in <desc>; has role="img" with an accessible name; and encodes series by line dash and marker shape as
 * well as colour, so no meaning rests on colour alone. Data tables in the report are the text alternative.
 */
import { BANNER } from './label.js';

const W = 640;
const H = 380;
const M = { top: 60, right: 30, bottom: 70, left: 70 };
const DASHES = Object.freeze(['', '6 4', '2 3', '10 3 2 3']);
const SHAPES = Object.freeze(['circle', 'square', 'triangle', 'diamond']);
const COLOURS = Object.freeze(['#1d4f5c', '#a4501c', '#5b3f8c', '#2e6b30']);

/** @param {unknown} s */
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3));

/** Linear scale from a domain to pixels. @param {number} d0 @param {number} d1 @param {number} r0 @param {number} r1 */
function scale(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Nice-ish ticks in [lo, hi]. */
function ticks(lo, hi, n = 5) {
  const step = (hi - lo) / n || 1;
  return Array.from({ length: n + 1 }, (_, i) => lo + i * step);
}

/**
 * Wraps the shapes in an SVG element with the accessible name, description, banner and footer.
 * @param {{ title:string, desc:string, body:string[], footer?:string[] }} o
 */
function frame(o) {
  const banner = o.banner ?? BANNER;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`,
    `<title id="t">${esc(`${o.title}. ${banner}`)}</title>`,
    `<desc id="d">${esc(`${o.desc} ${banner}.`)}</desc>`,
    `<text x="${M.left}" y="20" font-size="12" font-weight="bold">${esc(banner)}</text>`,
    `<text x="${M.left}" y="36" font-size="14">${esc(o.title)}</text>`,
    ...o.body,
    ...(o.footer ?? []),
    `<text x="${M.left}" y="${H - 12}" font-size="11">${esc(banner)}</text>`,
    '</svg>',
  ];
  return lines.join('\n');
}

/** Axes with tick labels and axis titles. */
function axes(xs, ys, xLabel, yLabel, x, y) {
  const out = [];
  out.push(`<line x1="${M.left}" y1="${H - M.bottom}" x2="${W - M.right}" y2="${H - M.bottom}" stroke="#333"/>`);
  out.push(`<line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${H - M.bottom}" stroke="#333"/>`);
  for (const t of xs) {
    out.push(`<line x1="${x(t)}" y1="${H - M.bottom}" x2="${x(t)}" y2="${H - M.bottom + 4}" stroke="#333"/>`);
    out.push(`<text x="${x(t)}" y="${H - M.bottom + 16}" font-size="11" text-anchor="middle">${esc(fmt(t))}</text>`);
  }
  for (const t of ys) {
    out.push(`<line x1="${M.left - 4}" y1="${y(t)}" x2="${M.left}" y2="${y(t)}" stroke="#333"/>`);
    out.push(`<text x="${M.left - 8}" y="${y(t) + 4}" font-size="11" text-anchor="end">${esc(fmt(t))}</text>`);
  }
  out.push(`<text x="${(M.left + W - M.right) / 2}" y="${H - 36}" font-size="12" text-anchor="middle">${esc(xLabel)}</text>`);
  out.push(`<text x="16" y="${(M.top + H - M.bottom) / 2}" font-size="12" transform="rotate(-90 16 ${(M.top + H - M.bottom) / 2})" text-anchor="middle">${esc(yLabel)}</text>`);
  return out;
}

/** Marker shape for series i. */
function marker(i, cx, cy, colour) {
  const s = SHAPES[i % SHAPES.length];
  if (s === 'square') return `<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="${colour}"/>`;
  if (s === 'triangle') return `<polygon points="${cx},${cy - 4} ${cx - 4},${cy + 3} ${cx + 4},${cy + 3}" fill="${colour}"/>`;
  if (s === 'diamond') return `<polygon points="${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}" fill="${colour}"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="3" fill="${colour}"/>`;
}

/**
 * Line chart with optional Monte Carlo bands (lo/hi per point). Each series has its own dash and marker.
 * @param {{ title:string, desc:string, xLabel:string, yLabel:string, series:Array<{name:string, points:Array<{x:number,y:number,lo?:number,hi?:number}>}>, yMin?:number, yMax?:number, yRef?:number }} spec
 */
export function lineChartSvg(spec) {
  const pts = spec.series.flatMap((s) => s.points);
  if (pts.length === 0) throw new RangeError('lineChartSvg needs at least one point');
  const xs = pts.map((p) => p.x);
  const ysAll = pts.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]);
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = spec.yMin ?? Math.min(...ysAll);
  const yHi = spec.yMax ?? Math.max(...ysAll);
  const x = scale(xLo, xHi, M.left, W - M.right);
  const y = scale(yLo, yHi, H - M.bottom, M.top);
  const body = [];
  if (spec.yRef !== undefined) {
    body.push(`<line x1="${M.left}" y1="${y(spec.yRef)}" x2="${W - M.right}" y2="${y(spec.yRef)}" stroke="#777" stroke-dasharray="3 3"/>`);
  }
  spec.series.forEach((s, i) => {
    const colour = COLOURS[i % COLOURS.length];
    const dash = DASHES[i % DASHES.length];
    const sorted = [...s.points].sort((a, b) => a.x - b.x);
    if (sorted.some((p) => p.lo !== undefined && p.hi !== undefined)) {
      const top = sorted.map((p) => `${x(p.x)},${y(p.hi ?? p.y)}`);
      const bottom = sorted.map((p) => `${x(p.x)},${y(p.lo ?? p.y)}`).reverse();
      body.push(`<polygon points="${[...top, ...bottom].join(' ')}" fill="${colour}" fill-opacity="0.12" stroke="none"/>`);
    }
    body.push(`<polyline points="${sorted.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="${dash}"/>`);
    for (const p of sorted) body.push(marker(i, x(p.x), y(p.y), colour));
  });
  const legend = spec.series.map((s, i) => {
    const colour = COLOURS[i % COLOURS.length];
    const yy = M.top - 12 + (i % 2) * 14;
    const xx = M.left + Math.floor(i / 2) * 260;
    return `<line x1="${xx}" y1="${yy - 4}" x2="${xx + 24}" y2="${yy - 4}" stroke="${colour}" stroke-width="2" stroke-dasharray="${DASHES[i % DASHES.length]}"/><text x="${xx + 30}" y="${yy}" font-size="11">${esc(s.name)}</text>`;
  });
  return frame({
    title: spec.title,
    desc: spec.desc,
    body: [...axes(ticks(xLo, xHi), ticks(yLo, yHi), spec.xLabel, spec.yLabel, x, y), ...body],
    footer: legend,
  });
}

/**
 * Bar chart: one bar per labelled value, with an optional interval per bar. Bars are labelled with their value.
 * @param {{ title:string, desc:string, yLabel:string, bars:Array<{label:string, value:number|null, lo?:number|null, hi?:number|null}> }} spec
 */
export function barChartSvg(spec) {
  const vals = spec.bars.filter((b) => b.value !== null);
  const top = Math.max(1, ...vals.map((b) => b.hi ?? b.value ?? 0));
  const n = spec.bars.length || 1;
  const band = (W - M.left - M.right) / n;
  const y = scale(0, top * 1.05, H - M.bottom, M.top);
  const body = [];
  for (const t of ticks(0, top * 1.05)) {
    body.push(`<text x="${M.left - 8}" y="${y(t) + 4}" font-size="11" text-anchor="end">${esc(fmt(t))}</text>`);
  }
  body.push(`<line x1="${M.left}" y1="${H - M.bottom}" x2="${W - M.right}" y2="${H - M.bottom}" stroke="#333"/>`);
  body.push(`<text x="16" y="${(M.top + H - M.bottom) / 2}" font-size="12" transform="rotate(-90 16 ${(M.top + H - M.bottom) / 2})" text-anchor="middle">${esc(spec.yLabel)}</text>`);
  spec.bars.forEach((b, i) => {
    const cx = M.left + band * (i + 0.5);
    const label = b.label.length > 16 ? `${b.label.slice(0, 15)}…` : b.label;
    body.push(`<text x="${cx}" y="${H - M.bottom + 14}" font-size="10" text-anchor="middle">${esc(label)}</text>`);
    if (b.value === null) {
      body.push(`<text x="${cx}" y="${H - M.bottom - 6}" font-size="10" text-anchor="middle">n/a</text>`);
      return;
    }
    const barW = band * 0.6;
    body.push(`<rect x="${cx - barW / 2}" y="${y(b.value)}" width="${barW}" height="${H - M.bottom - y(b.value)}" fill="${COLOURS[0]}" fill-opacity="0.7" stroke="${COLOURS[0]}"/>`);
    if (b.lo !== null && b.lo !== undefined && b.hi !== null && b.hi !== undefined) {
      body.push(`<line x1="${cx}" y1="${y(b.lo)}" x2="${cx}" y2="${y(b.hi)}" stroke="#222"/>`);
    }
    body.push(`<text x="${cx}" y="${y(b.value) - 4}" font-size="10" text-anchor="middle">${esc(fmt(b.value))}</text>`);
  });
  return frame({ title: spec.title, desc: spec.desc, body, footer: [], banner: spec.banner });
}

/**
 * Calendar chart: cards per month of the window, with the bootstrap range as a bar outline (dashed) and the median as
 * a solid bar. Labels carry the values, so colour is not needed.
 * @param {{ title:string, desc:string, yLabel:string, months:Array<{label:string, median:number, lo:number, hi:number}> }} spec
 */
export function calendarChartSvg(spec) {
  return barChartSvg({
    title: spec.title,
    desc: spec.desc,
    yLabel: spec.yLabel,
    bars: spec.months.map((m) => ({ label: m.label, value: m.median, lo: m.lo, hi: m.hi })),
  });
}

/**
 * Heat grid of counts (rows × columns) with the count printed in each cell. Shade and printed number carry the value.
 * @param {{ title:string, desc:string, rows:string[], cols:string[], cells:Array<{row:string, col:string, count:number}>, banner?:string }} spec
 * `banner` replaces the synthetic banner for real data (REAL- figures)
 */
export function heatmapSvg(spec) {
  const cw = (W - M.left - 20) / spec.cols.length;
  const rh = (H - M.top - 90) / spec.rows.length;
  const max = Math.max(1, ...spec.cells.map((c) => c.count));
  const body = [];
  spec.cols.forEach((c, j) => {
    body.push(`<text x="${M.left + cw * (j + 0.5)}" y="${M.top - 6}" font-size="9" text-anchor="middle">${esc(c)}</text>`);
  });
  spec.rows.forEach((r, i) => {
    body.push(`<text x="${M.left - 6}" y="${M.top + rh * (i + 0.5) + 4}" font-size="10" text-anchor="end">${esc(r)}</text>`);
    spec.cols.forEach((c, j) => {
      const cell = spec.cells.find((x) => x.row === r && x.col === c);
      const count = cell ? cell.count : 0;
      const shade = 0.08 + 0.85 * (count / max);
      body.push(`<rect x="${M.left + cw * j}" y="${M.top + rh * i}" width="${cw}" height="${rh}" fill="${COLOURS[0]}" fill-opacity="${shade.toFixed(2)}" stroke="#fff"/>`);
      body.push(`<text x="${M.left + cw * (j + 0.5)}" y="${M.top + rh * (i + 0.5) + 4}" font-size="10" text-anchor="middle" fill="${shade > 0.5 ? '#fff' : '#111'}">${count}</text>`);
    });
  });
  return frame({ title: spec.title, desc: spec.desc, body, footer: [], banner: spec.banner });
}
