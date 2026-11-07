import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Timeline } from './Timeline.jsx';

const CAPTION = 'Dates and values as recorded by ACAPS analysts. Completion rate is a judgement whose meaning has not been standardised.';
const HEADING = 'How this risk has been recorded to change';

const TL = {
  riskTrend: 'Deteriorated',
  rationaleUpdates: [
    { date: '2026-02-10', text: 'Second update text.' },
    { date: null, text: 'Opening text before any header.' },
    { date: '2026-04-01', text: 'Newest update text.' },
  ],
  triggers: [
    {
      id: 'T1', title: 'Second district reports cases',
      completion: [{ date: '2026-01-05', value: 20 }, { date: '2026-02-01', value: 45 }, { date: '2026-03-01', value: 60 }],
      trend: [{ date: '2026-01-05', value: 'Stable' }, { date: '2026-03-01', value: 'Deteriorated' }],
      dateEntered: '2026-01-05', lastUpdate: '2026-03-01', movement: { completion: 'up', trend: 'down' },
    },
    { id: 'T2', title: 'Market prices double', completion: [], trend: [], dateEntered: '2026-01-05', lastUpdate: '2026-01-05', movement: { completion: 'none', trend: 'none' } },
    {
      id: 'T3', title: 'Single reading trigger',
      completion: [{ date: '2026-02-14', value: 30 }], trend: [],
      dateEntered: '2026-02-14', lastUpdate: '2026-02-14', movement: { completion: 'none', trend: 'none' },
    },
  ],
  span: { from: '2026-01-05', to: '2026-04-01' },
  points: 7,
};

const EMPTY = { riskTrend: null, rationaleUpdates: [], triggers: [], span: null, points: 0 };

describe('Timeline', () => {
  it('renders nothing when there is no timeline', () => {
    const { container } = render(<Timeline />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has the heading and the caption, word for word', () => {
    render(<Timeline timeline={TL} />);
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument();
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
  });

  it('draws a completion chart for each trigger with history and omits a trigger with none', () => {
    render(<Timeline timeline={TL} />);
    expect(screen.getByRole('img', { name: 'Completion rate: Second district reports cases' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Completion rate: Single reading trigger' })).toBeInTheDocument();
    expect(screen.queryByText('Market prices double')).toBeNull();
  });

  it('shows the trend as words with their dates, not by colour alone', () => {
    render(<Timeline timeline={TL} />);
    const trend = screen.getByRole('list', { name: 'Trend: Second district reports cases' });
    const items = within(trend).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Stable2026-01-05', 'Deteriorated2026-03-01']);
  });

  it('flags a same-day trend pair in words, beside each conflicting pill and no other', () => {
    const SAME_DAY = {
      id: 'T4', title: 'Same-day trend', completion: [], dateEntered: '2026-03-01', lastUpdate: '2026-04-01',
      trend: [
        { date: '2026-03-01', value: 'Stable', conflict: true },
        { date: '2026-03-01', value: 'Deteriorated', conflict: true },
        { date: '2026-04-01', value: 'Deteriorated', conflict: false },
      ],
      movement: { completion: 'none', trend: 'down' },
    };
    render(<Timeline timeline={{ ...EMPTY, triggers: [SAME_DAY] }} />);
    const items = within(screen.getByRole('list', { name: 'Trend: Same-day trend' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('same day, order as recorded')).toBeInTheDocument();
    expect(within(items[1]).getByText('same day, order as recorded')).toBeInTheDocument();
    expect(items[2]).not.toHaveTextContent('same day');
  });

  it('says plainly when a trigger has a single reading', () => {
    render(<Timeline timeline={TL} />);
    expect(screen.getAllByText('One reading, no movement to show')).toHaveLength(1);
    const single = screen.getByRole('img', { name: 'Completion rate: Single reading trigger' }).closest('article');
    expect(within(single).getByText('One reading, no movement to show')).toBeInTheDocument();
  });

  it('lists the rationale updates newest first, with the text in a details element', () => {
    const { container } = render(<Timeline timeline={TL} />);
    const times = [...container.querySelectorAll('.tl-updates time')].map((t) => t.textContent);
    expect(times).toEqual(['2026-04-01', '2026-02-10', 'Undated']);
    const newest = screen.getByText('Newest update text.');
    expect(newest.closest('details')).not.toBeNull();
  });

  it('an empty history says there are no dated changes', () => {
    render(<Timeline timeline={EMPTY} />);
    expect(screen.getByText('ACAPS has recorded no dated changes for this risk.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('never states a duration or a lag between dates', () => {
    const { container } = render(<Timeline timeline={TL} />);
    expect(container.textContent).not.toMatch(/\b(day|days|week|weeks|month|months|year|years)\b|\blater\b|\blag\b|\belapsed\b/i);
  });
});
