// SVG charts: every chart carries the banner in visible text, <title> and <desc>, role="img", balanced tags (power-spec §E).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChartSvg, barChartSvg, calendarChartSvg, heatmapSvg } from '../src/charts.js';
import { BANNER } from '../src/label.js';

const LINE = lineChartSvg({
  title: 'Power against cards',
  desc: 'Power rises with cards.',
  xLabel: 'Cards',
  yLabel: 'Power',
  series: [
    { name: 'k = 8', points: [{ x: 20, y: 0.1, lo: 0.08, hi: 0.12 }, { x: 60, y: 0.4, lo: 0.37, hi: 0.43 }] },
    { name: 'k = 3', points: [{ x: 20, y: 0.05 }, { x: 60, y: 0.2 }] },
  ],
});
const BAR = barChartSvg({
  title: 'Cards needed',
  desc: 'Cards needed per setting.',
  yLabel: 'Cards',
  bars: [{ label: 'k = 3', value: 528, lo: 500, hi: 560 }, { label: 'k = 8', value: null }],
});
const CAL = calendarChartSvg({
  title: 'Calendar',
  desc: 'Cards by month.',
  yLabel: 'Cards',
  months: [{ label: '6 mo', median: 22, lo: 18, hi: 31 }],
});
const HEAT = heatmapSvg({
  title: 'Strata',
  desc: 'Counts by region and theme.',
  rows: ['Asia', 'Africa'],
  cols: ['Conflict', 'Climate'],
  cells: [{ row: 'Asia', col: 'Conflict', count: 4 }],
});
const ALL = { line: LINE, bar: BAR, calendar: CAL, heat: HEAT };

test('every chart has role img, an accessible name and description, and the banner in title and desc', () => {
  for (const [name, svg] of Object.entries(ALL)) {
    assert.match(svg, /role="img"/, `${name} lacks role=img`);
    assert.match(svg, /aria-labelledby="t d"/, `${name} lacks a label reference`);
    assert.ok(svg.includes(`<title id="t">`) && svg.includes(`<desc id="d">`), `${name} lacks title or desc`);
    const title = svg.match(/<title id="t">([^<]*)<\/title>/)[1];
    const desc = svg.match(/<desc id="d">([^<]*)<\/desc>/)[1];
    assert.ok(title.includes(BANNER), `${name} title lacks the banner`);
    assert.ok(desc.includes(BANNER), `${name} desc lacks the banner`);
  }
});

test('every chart shows the banner as visible text inside the SVG', () => {
  for (const [name, svg] of Object.entries(ALL)) {
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    assert.ok(texts.includes(BANNER), `${name} has no visible banner <text>`);
  }
});

test('tags are balanced: every opened element of the chart is closed', () => {
  for (const [name, svg] of Object.entries(ALL)) {
    for (const tag of ['text', 'title', 'desc']) {
      const opens = (svg.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;
      const closes = (svg.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.equal(opens, closes, `${name}: <${tag}> is unbalanced`);
    }
    assert.equal((svg.match(/<svg\b/g) ?? []).length, 1, `${name} must be one svg`);
    assert.ok(svg.trimEnd().endsWith('</svg>'), `${name} does not close the svg`);
  }
});

test('the line chart encodes series by dash and marker shape, not colour alone', () => {
  assert.match(LINE, /stroke-dasharray="6 4"/);
  assert.match(LINE, /<rect /);
  assert.match(LINE, /<circle /);
});

test('the line chart draws the Monte Carlo band as a polygon', () => {
  assert.match(LINE, /<polygon points="[^"]+" fill="#1d4f5c" fill-opacity="0\.12"/);
});

test('a missing value is shown as n/a, not as a zero bar', () => {
  assert.match(BAR, />n\/a</);
});

test('text from the data is escaped, so a title cannot inject markup', () => {
  const svg = barChartSvg({ title: '<script>x</script>', desc: 'd', yLabel: 'y', bars: [{ label: 'a', value: 1 }] });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('the line chart refuses an empty series', () => {
  assert.throws(() => lineChartSvg({ title: 't', desc: 'd', xLabel: 'x', yLabel: 'y', series: [] }), RangeError);
});
