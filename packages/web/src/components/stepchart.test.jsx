import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StepChart } from './StepChart.jsx';

// Geometry of the chart: viewBox 640 x 260, left margin 56, right 20, top 18, bottom 44, so the plot is 564 x 198.
// y(v) = 18 + (1 - v / 100) * 198 and x(date) = 56 + (days since the first date / days in the span) * 564.
const y = (v) => 18 + (1 - v / 100) * 198;

/** The path as absolute segments, from the M/H/V form the chart writes. */
function segments(d) {
  const t = d.trim().split(/\s+/);
  let x = Number(t[0].slice(1));
  let cy = Number(t[1]);
  const out = [];
  for (const tok of t.slice(2)) {
    const from = [x, cy];
    const v = Number(tok.slice(1));
    if (tok[0] === 'H') x = v; else cy = v;
    out.push({ kind: tok[0], from, to: [x, cy] });
  }
  return out;
}

const THREE = [
  { date: '2026-01-01', value: 20 },
  { date: '2026-01-31', value: 60 },
  { date: '2026-03-02', value: 40 },
];

describe('StepChart geometry', () => {
  it('holds each value until the next date: horizontal runs at the old value, then a vertical step', () => {
    const { container } = render(<StepChart title="Completion rate: T" points={THREE} />);
    const segs = segments(container.querySelector('path').getAttribute('d'));
    const runs = segs.filter((s) => s.kind === 'H');
    expect(runs).toHaveLength(2);
    // 20% holds from 1 January to 31 January (x 56 to 338), then 60% holds to 2 March (x 338 to 620).
    expect(runs[0].from[0]).toBeCloseTo(56);
    expect(runs[0].to[0]).toBeCloseTo(338);
    expect(runs[0].from[1]).toBeCloseTo(y(20));
    expect(runs[1].from[0]).toBeCloseTo(338);
    expect(runs[1].to[0]).toBeCloseTo(620);
    expect(runs[1].from[1]).toBeCloseTo(y(60));
    // Nothing slopes: every segment is either flat or vertical.
    for (const s of segs) expect(s.from[0] === s.to[0] || s.from[1] === s.to[1]).toBe(true);
  });

  it('spaces the points by the calendar, not by their order', () => {
    const { container } = render(<StepChart title="T" points={THREE} />);
    const cx = [...container.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cx')));
    expect(cx[0]).toBeCloseTo(56);
    expect(cx[1]).toBeCloseTo(338); // 30 of 60 days
    expect(cx[2]).toBeCloseTo(620);
    const cy = [...container.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
    expect(cy[0]).toBeCloseTo(y(20));
    expect(cy[1]).toBeCloseTo(y(60));
    expect(cy[2]).toBeCloseTo(y(40));
  });

  it('draws the gridlines and labels at 0, 50 and 100 and labels the first and last dates', () => {
    const { container } = render(<StepChart title="T" points={THREE} />);
    const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
    for (const l of ['0%', '50%', '100%', '2026-01-01', '2026-03-02']) expect(labels).toContain(l);
    expect(container.querySelectorAll('line.sc-grid')).toHaveLength(3);
  });

  it('puts same-day entries at the same x, as consecutive points', () => {
    const { container } = render(<StepChart title="T" points={[{ date: '2026-01-05', value: 30 }, { date: '2026-01-05', value: 70 }, { date: '2026-02-01', value: 50 }]} />);
    const cx = [...container.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cx')));
    expect(cx[0]).toBeCloseTo(cx[1]);
    expect(cx[2]).toBeGreaterThan(cx[1]);
  });

  it('keeps the file order for same-day entries', () => {
    const { container } = render(<StepChart title="T" points={[{ date: '2026-01-05', value: 30 }, { date: '2026-01-05', value: 70 }, { date: '2026-02-01', value: 50 }]} />);
    const rows = within(container.querySelector('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('30%');
    expect(rows[1]).toHaveTextContent('70%');
  });
});

describe('StepChart states', () => {
  it('a single point is a dot with its date, never a line', () => {
    const { container } = render(<StepChart title="T" points={[{ date: '2026-02-14', value: 30 }]} />);
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(within(container.querySelector('svg')).getByText('2026-02-14')).toBeInTheDocument();
  });

  it('an empty series says so and draws nothing', () => {
    const { container } = render(<StepChart title="T" points={[]} />);
    expect(screen.getByText('No dated history recorded.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('flags a same-day entry as "same day, order as recorded" on the later row only', () => {
    render(<StepChart title="T" points={[{ date: '2026-01-05', value: 30 }, { date: '2026-01-05', value: 70 }]} />);
    expect(screen.getAllByText('same day, order as recorded')).toHaveLength(1);
    const later = screen.getByText('same day, order as recorded').closest('tr');
    expect(later).toHaveTextContent('70%');
  });

  it('sorts by date, keeping same-day order', () => {
    const { container } = render(<StepChart title="T" points={[{ date: '2026-03-01', value: 10 }, { date: '2026-01-01', value: 90 }]} />);
    const rows = within(container.querySelector('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('2026-01-01');
    expect(rows[1]).toHaveTextContent('2026-03-01');
  });
});

describe('StepChart accessibility', () => {
  it('is a labelled image with a title and description, and a table of its values', () => {
    render(<StepChart title="Completion rate: Second district" points={THREE} />);
    expect(screen.getByRole('img', { name: 'Completion rate: Second district' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Completion rate: Second district' }).querySelector('desc')).toHaveTextContent('Latest: 40% on 2026-03-02.');
    const table = screen.getByRole('table', { name: 'Completion rate: Second district: values' });
    expect(table).toHaveClass('stack');
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual(['2026-01-0120%', '2026-01-3160%', '2026-03-0240%']);
  });

  it('shows a caption when one is given', () => {
    render(<StepChart title="T" points={THREE} caption="Recorded by ACAPS." />);
    expect(screen.getByText('Recorded by ACAPS.')).toBeInTheDocument();
  });
});
