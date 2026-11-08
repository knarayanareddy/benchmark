import { describe, it, expect } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Evolution } from './Evolution.jsx';
import { routes, fail } from '../test-helpers.js';
import { THEMES } from '@benchmark/core/taxonomy';

const MOD = { id: 'mod1', role: 'moderator' };
const ANALYST = { id: 'an1', role: 'analyst' };
const stmt = (id) => `Statement ${id}`;
const CARDS = ['C1', 'C2', 'C3', 'C4', 'C5'].map((id) => ({ id, statement: stmt(id), status: 'open', round: 1, responses: 0 }));
const SERIES = {
  cardId: 'C1', statement: stmt('C1'), status: 'closed',
  points: [
    { round: 1, day: '2026-10-02', n: 7, estimate: 0.62, lo: 0.55, hi: 0.7 },
    { round: 2, day: '2026-10-20', n: 9, estimate: 0.625, lo: 0.5, hi: 0.75 },
  ],
  withheld: [{ round: 3 }],
  note: 'There are at most two rounds per card; later windows are new cards.',
};
const GRID = {
  regions: ['Sahel & West/Central Africa', 'East & Southern Africa'],
  themes: ['health', 'climate'],
  minCell: 10,
  cells: [
    { region: 'Sahel & West/Central Africa', theme: 'health', risks: 14, cards: 2, live: 1, small: false },
    { region: 'Sahel & West/Central Africa', theme: 'climate', risks: 3, cards: 1, live: 0, small: true },
    { region: 'East & Southern Africa', theme: 'health', risks: 0, cards: 0, live: 0, small: true },
    { region: 'East & Southern Africa', theme: 'climate', risks: 12, cards: 0, live: 0, small: false },
  ],
};
const MECH = 'Displaced people move by road and close the rail corridor.';
const RIVAL = 'Both follow the national budget cycle, not each other.';
const link = (id, from, to) => ({ id, fromCardId: from, toCardId: to, fromStatement: stmt(from), toStatement: stmt(to), mechanism: MECH, rival: RIVAL, by: 'mod1', day: '2026-10-05' });
const LINKS = [link('L1', 'C1', 'C2')];

/** The whole tab, with every read it makes answered; extra routes are merged in. */
function tab(me, extra = {}) {
  const api = routes({
    'GET /api/staff/cards': CARDS,
    'GET /api/staff/evolution/grid': GRID,
    'GET /api/staff/links': LINKS,
    'GET /api/staff/cards/C1/series': SERIES,
    ...extra,
  });
  return { api, ...render(<Evolution api={api} me={me} />) };
}
/** The Panel's select is the one labelled 'Card'; the other selects offer the same cards. */
const cardsLoaded = () => waitFor(() => expect(screen.getByLabelText('Card').querySelectorAll('option')).toHaveLength(CARDS.length + 1));
const posts = (api) => api.mock.calls.filter((c) => c[0] === 'POST');
const deletes = (api) => api.mock.calls.filter((c) => c[0] === 'DELETE');

describe('panel over the rounds', () => {
  it('makes no series request until a card is chosen', async () => {
    const { api } = tab(MOD);
    await cardsLoaded();
    expect(api.mock.calls.some((c) => String(c[1]).includes('/series'))).toBe(false);
  });

  it('shows each round with its day, experts, estimate and interval as percentages', async () => {
    const { api } = tab(MOD);
    await cardsLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Card'), 'C1');
    expect(api).toHaveBeenCalledWith('GET', '/api/staff/cards/C1/series');
    const row1 = (await screen.findByText('Round 1')).closest('tr');
    expect(row1).toHaveTextContent('2026-10-02');
    expect(row1).toHaveTextContent('7 experts');
    expect(within(row1).getByText('62%')).toBeInTheDocument();
    expect(row1).toHaveTextContent('interval 55% to 70%');
    expect(row1.querySelector('svg')).not.toBeNull();
  });

  it('shows the estimate to one decimal at most', async () => {
    tab(MOD);
    await cardsLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Card'), 'C1');
    const row2 = (await screen.findByText('Round 2')).closest('tr');
    expect(within(row2).getByText('62.5%')).toBeInTheDocument();
    expect(row2).toHaveTextContent('interval 50% to 75%');
  });

  it('a withheld round is one row with no numbers beyond its round and the fewer-than-5 floor', async () => {
    tab(MOD);
    await cardsLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Card'), 'C1');
    const row = (await screen.findByText(/Round 3: withheld/)).closest('tr');
    expect(row).toHaveTextContent(/^Round 3: withheld, fewer than 5 respondents$/);
    // The only digits allowed in the row are the round (3) and the floor sentence's 5. No estimate, interval, count or day.
    const digits = row.textContent.match(/\d+/g) ?? [];
    expect(digits.filter((d) => d !== '3' && d !== '5')).toEqual([]);
    expect(row.textContent).not.toMatch(/%|experts|\d{4}-\d{2}/);
  });

  it('shows the series note', async () => {
    tab(MOD);
    await cardsLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Card'), 'C1');
    expect(await screen.findByText(SERIES.note)).toBeInTheDocument();
  });

  it('a failed series request is an alert', async () => {
    tab(MOD, { 'GET /api/staff/cards/C2/series': fail(500, 'the ledger could not be read') });
    await cardsLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Card'), 'C2');
    expect(await screen.findByRole('alert')).toHaveTextContent('the ledger could not be read');
  });
});

describe('regional grid', () => {
  it('states that small cells are descriptive only, with the floor', async () => {
    tab(MOD);
    expect(await screen.findByText('Cells with fewer than 10 risks are descriptive only; no association is implied.')).toBeInTheDocument();
  });

  it('is a true two-way table in a sideways-scrolling region, with the theme labels from the shared taxonomy', async () => {
    tab(MOD);
    const table = await screen.findByRole('table', { name: 'Risks and cards by region and theme' });
    expect(table).not.toHaveClass('stack'); // collapsing into blocks would lose the column a number belongs to
    expect(table.closest('[role="region"]')).toHaveAttribute('aria-label', expect.stringMatching(/scrolls sideways/));
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Region', THEMES.health, THEMES.climate]);
  });

  it('shows risks, and cards with live count where there are cards', async () => {
    tab(MOD);
    const table = await screen.findByRole('table', { name: 'Risks and cards by region and theme' });
    const row = within(table).getByRole('rowheader', { name: 'Sahel & West/Central Africa' }).closest('tr');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('14 risks');
    expect(cells[0]).toHaveTextContent('2 cards (1 live)');
    expect(cells[0]).not.toHaveTextContent('descriptive only');
    const east = within(table).getByRole('rowheader', { name: 'East & Southern Africa' }).closest('tr');
    expect(within(east).getAllByRole('cell')[1]).toHaveTextContent('12 risks');
    expect(within(east).getAllByRole('cell')[1]).not.toHaveTextContent('cards');
  });

  it('marks small cells as muted with a "descriptive only" marker', async () => {
    tab(MOD);
    const table = await screen.findByRole('table', { name: 'Risks and cards by region and theme' });
    const row = within(table).getByRole('rowheader', { name: 'Sahel & West/Central Africa' }).closest('tr');
    const small = within(row).getAllByRole('cell')[1];
    expect(small).toHaveClass('ev-small');
    expect(small).toHaveAttribute('title', 'descriptive only');
    expect(within(small).getByText('descriptive only')).toBeInTheDocument();
    expect(small).toHaveTextContent('3 risks');
    expect(small).toHaveTextContent('1 card (0 live)');
    expect(screen.getAllByText('descriptive only')).toHaveLength(2);
  });
});

describe('analyst links', () => {
  it('lists each link as analyst judgement with its mechanism and rival', async () => {
    tab(ANALYST);
    await screen.findByText(MECH);
    const item = screen.getByText(MECH).closest('li');
    expect(within(item).getByText('Analyst judgement, not a finding')).toBeInTheDocument();
    expect(item).toHaveTextContent(`From: ${stmt('C1')}`);
    expect(item).toHaveTextContent(`To: ${stmt('C2')}`);
    expect(item).toHaveTextContent(RIVAL);
  });

  it('an analyst sees no create form and no remove control, but can follow the chain', async () => {
    tab(ANALYST);
    await screen.findByText(MECH);
    expect(screen.queryByRole('button', { name: /Remove link/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record link' })).toBeNull();
    expect(screen.queryByLabelText(/Mechanism/)).toBeNull();
    expect(screen.queryByLabelText(/Rival explanation/)).toBeNull();
    expect(screen.queryByLabelText(/From card/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Card to follow'), 'C1');
    await userEvent.click(screen.getByRole('button', { name: 'Show downstream' }));
    expect(screen.getByText(`Step 1: ${stmt('C2')}, after ${stmt('C1')}`)).toBeInTheDocument();
  });

  it('a moderator gets the create form with both required labels and two card selects', async () => {
    tab(MOD);
    await screen.findByText(MECH);
    expect(screen.getByLabelText('Mechanism (required)')).toBeInTheDocument();
    expect(screen.getByLabelText('Rival explanation (required)')).toBeInTheDocument();
    expect(screen.getByLabelText('From card (required)').querySelectorAll('option')).toHaveLength(CARDS.length + 1);
    expect(screen.getByLabelText('To card (required)').querySelectorAll('option')).toHaveLength(CARDS.length + 1);
  });

  it('live counters show the trimmed length against the 500 limit and the 20 minimum', async () => {
    tab(MOD);
    await screen.findByText(MECH);
    await userEvent.type(screen.getByLabelText('Mechanism (required)'), '  abcde  ');
    expect(screen.getByText('5 of 500 characters; at least 20 needed.')).toBeInTheDocument();
  });

  it('posts exactly the four fields, trimmed, and says it was recorded', async () => {
    const { api } = tab(MOD, {
      'POST /api/staff/links': (b) => {
        expect(Object.keys(b).sort()).toEqual(['fromCardId', 'mechanism', 'rival', 'toCardId']);
        return { id: 'L2' };
      },
    });
    await screen.findByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('From card (required)'), 'C2');
    await userEvent.selectOptions(screen.getByLabelText('To card (required)'), 'C3');
    await userEvent.type(screen.getByLabelText('Mechanism (required)'), `  ${MECH}  `);
    await userEvent.type(screen.getByLabelText('Rival explanation (required)'), RIVAL);
    await userEvent.click(screen.getByRole('button', { name: 'Record link' }));
    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/staff/links', { fromCardId: 'C2', toCardId: 'C3', mechanism: MECH, rival: RIVAL });
    expect(await screen.findByRole('status')).toHaveTextContent('Link recorded.');
  });

  it('the mechanism is required: too short is refused client-side, with no request', async () => {
    const { api } = tab(MOD);
    await screen.findByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('From card (required)'), 'C2');
    await userEvent.selectOptions(screen.getByLabelText('To card (required)'), 'C3');
    await userEvent.type(screen.getByLabelText('Mechanism (required)'), 'too short');
    await userEvent.type(screen.getByLabelText('Rival explanation (required)'), RIVAL);
    await userEvent.click(screen.getByRole('button', { name: 'Record link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The mechanism needs 20 to 500 characters; it has 9.');
    expect(posts(api)).toHaveLength(0);
  });

  it('the rival explanation is required: blank is refused client-side, with no request', async () => {
    const { api } = tab(MOD);
    await screen.findByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('From card (required)'), 'C2');
    await userEvent.selectOptions(screen.getByLabelText('To card (required)'), 'C3');
    await userEvent.type(screen.getByLabelText('Mechanism (required)'), MECH);
    await userEvent.click(screen.getByRole('button', { name: 'Record link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The rival explanation needs 20 to 500 characters; it has 0.');
    expect(posts(api)).toHaveLength(0);
  });

  it('both cards are required and must differ, client-side', async () => {
    const { api } = tab(MOD);
    await screen.findByText(MECH);
    await userEvent.type(screen.getByLabelText('Mechanism (required)'), MECH);
    await userEvent.type(screen.getByLabelText('Rival explanation (required)'), RIVAL);
    await userEvent.click(screen.getByRole('button', { name: 'Record link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the card the link comes from and the card it leads to.');
    await userEvent.selectOptions(screen.getByLabelText('From card (required)'), 'C2');
    await userEvent.selectOptions(screen.getByLabelText('To card (required)'), 'C2');
    await userEvent.click(screen.getByRole('button', { name: 'Record link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose two different cards.');
    expect(posts(api)).toHaveLength(0);
  });

  it('a server refusal is shown in role=alert', async () => {
    tab(MOD, { 'POST /api/staff/links': fail(409, 'a link from C2 to C3 already exists') });
    await screen.findByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('From card (required)'), 'C2');
    await userEvent.selectOptions(screen.getByLabelText('To card (required)'), 'C3');
    await userEvent.type(screen.getByLabelText('Mechanism (required)'), MECH);
    await userEvent.type(screen.getByLabelText('Rival explanation (required)'), RIVAL);
    await userEvent.click(screen.getByRole('button', { name: 'Record link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a link from C2 to C3 already exists');
  });

  it('removal is two steps: Remove asks, and only the confirmation deletes', async () => {
    const { api } = tab(MOD, { 'DELETE /api/staff/links/L1': () => ({}) });
    await screen.findByText(MECH);
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(deletes(api)).toHaveLength(0);
    expect(screen.getByText('Remove this link?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove this link' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('DELETE', '/api/staff/links/L1'));
  });

  it('Keep it cancels the removal without a request', async () => {
    const { api } = tab(MOD);
    await screen.findByText(MECH);
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument();
    expect(deletes(api)).toHaveLength(0);
  });

  it('a failed removal is shown in role=alert', async () => {
    tab(MOD, { 'DELETE /api/staff/links/L1': fail(500, 'the link could not be removed') });
    await screen.findByText(MECH);
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove this link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the link could not be removed');
  });

  it('downstream follows links up to three steps and ends at a cycle', async () => {
    tab(MOD, { 'GET /api/staff/links': [link('L1', 'C1', 'C2'), link('L2', 'C2', 'C3'), link('L3', 'C3', 'C1')] });
    await screen.findAllByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('Card to follow'), 'C1');
    await userEvent.click(screen.getByRole('button', { name: 'Show downstream' }));
    const items = within(screen.getByText(`Step 1: ${stmt('C2')}, after ${stmt('C1')}`).closest('ol')).getAllByRole('listitem');
    expect(items.map((i) => i.querySelector('p').textContent)).toEqual([`Step 1: ${stmt('C2')}, after ${stmt('C1')}`, `Step 2: ${stmt('C3')}, after ${stmt('C2')}`]);
  });

  it('the downstream heading carries the analyst-judgement label', async () => {
    tab(MOD);
    await screen.findByText(MECH);
    expect(screen.getByRole('heading', { name: /Downstream of a card/ })).toHaveTextContent('Analyst judgement, not a finding');
  });

  it('each downstream step shows the mechanism of the link that reached it', async () => {
    const M2 = 'Refugee arrivals strain the clinics in the second district.';
    tab(MOD, { 'GET /api/staff/links': [link('L1', 'C1', 'C2'), { ...link('L2', 'C2', 'C3'), mechanism: M2 }] });
    await screen.findAllByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('Card to follow'), 'C1');
    await userEvent.click(screen.getByRole('button', { name: 'Show downstream' }));
    const step1 = screen.getByText(`Step 1: ${stmt('C2')}, after ${stmt('C1')}`).closest('li');
    const step2 = screen.getByText(`Step 2: ${stmt('C3')}, after ${stmt('C2')}`).closest('li');
    expect(within(step1).getByText(`Mechanism: ${MECH}`)).toBeInTheDocument();
    expect(within(step2).getByText(`Mechanism: ${M2}`)).toBeInTheDocument();
  });

  it('a long downstream mechanism is shown in a details element', async () => {
    const LONG = `${MECH} ${'The rail corridor closes for the harvest season, so road traffic carries the displaced families west. '.repeat(2)}`.trim();
    tab(MOD, { 'GET /api/staff/links': [{ ...link('L1', 'C1', 'C2'), mechanism: LONG }] });
    await screen.findAllByText(LONG);
    await userEvent.selectOptions(screen.getByLabelText('Card to follow'), 'C1');
    await userEvent.click(screen.getByRole('button', { name: 'Show downstream' }));
    const step = screen.getByText(`Step 1: ${stmt('C2')}, after ${stmt('C1')}`).closest('li');
    const details = within(step).getByText(LONG).closest('details');
    expect(details).not.toBeNull();
    expect(within(details).getByText('Mechanism', { selector: 'summary' })).toBeInTheDocument();
  });

  it('downstream stops at three steps', async () => {
    tab(MOD, { 'GET /api/staff/links': [link('L1', 'C1', 'C2'), link('L2', 'C2', 'C3'), link('L3', 'C3', 'C4'), link('L4', 'C4', 'C5')] });
    await screen.findAllByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('Card to follow'), 'C1');
    await userEvent.click(screen.getByRole('button', { name: 'Show downstream' }));
    const chain = within(screen.getByText(`Step 3: ${stmt('C4')}, after ${stmt('C3')}`).closest('ol')).getAllByRole('listitem');
    expect(chain).toHaveLength(3);
    expect(chain.some((i) => i.textContent.includes(stmt('C5')))).toBe(false);
  });

  it('a card with nothing downstream says so', async () => {
    tab(MOD);
    await screen.findByText(MECH);
    await userEvent.selectOptions(screen.getByLabelText('Card to follow'), 'C5');
    await userEvent.click(screen.getByRole('button', { name: 'Show downstream' }));
    expect(screen.getByText('No links lead on from this card.')).toBeInTheDocument();
  });
});

describe('the whole tab', () => {
  it('a failed card list is an alert, and the other sections still load', async () => {
    tab(MOD, { 'GET /api/staff/cards': fail(500, 'cards are unavailable') });
    expect(await screen.findByText('cards are unavailable')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Risks and cards by region and theme' })).toBeInTheDocument();
  });

  it('the grid is requested from its route', async () => {
    const { api } = tab(ANALYST);
    await screen.findByRole('table', { name: 'Risks and cards by region and theme' });
    expect(api).toHaveBeenCalledWith('GET', '/api/staff/evolution/grid');
    expect(api).toHaveBeenCalledWith('GET', '/api/staff/links');
  });
});
