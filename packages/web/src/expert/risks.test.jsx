import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Risks } from './Risks.jsx';
import { routes, fail } from '../test-helpers.js';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';

const ROW = (over = {}) => ({ id: 'R1', title: 'Cholera outbreak in Chad spreads to the capital', country: 'Chad', region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic', hasQuestion: false, ...over });
const NEUTRAL_SENTENCE = "ACAPS's analysis of this risk is hidden while there is an open question about it, so your answer is your own. You will see it once the question is resolved.";
const FULL = { view: 'full', hasQuestion: false, id: 'R1', title: 'Cholera outbreak in Chad spreads to the capital', country: 'Chad', isos: ['TCD'], region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic', status: 'Ongoing', outcome: null, level: 'High', probability: 'Medium', impact: 'Very High', rationale: 'Rainy season and a weak water system raise the odds.', triggers: [{ id: 'T1', title: 'Second district reports cases', description: 'Two or more districts within a week.' }] };
const NEUTRAL_NO_QUESTION_SENTENCE = "ACAPS's analysis of this risk is kept back until a question about it has been answered and resolved, so that nobody's answer is shaped by it.";
const NEUTRAL = { view: 'neutral', hasQuestion: true, id: 'R1', title: 'Cholera outbreak in Chad spreads to the capital', country: 'Chad', isos: ['TCD'], region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic' };

/** A listing whose handler records every path it was asked for. */
function listing(rows, extra = {}) {
  const paths = [];
  const api = routes({
    'GET /api/risks': (_b, path) => { paths.push(path); return rows; },
    ...extra,
  });
  return { api, paths, last: () => paths[paths.length - 1] };
}

describe('Risks list', () => {
  it('lists each risk with its country, region, theme and an "Open question" pill only where one is open', async () => {
    const { api } = listing([ROW(), ROW({ id: 'R2', title: 'Rail strike in Kenya', country: 'Kenya', region: 'East & Southern Africa', theme: 'political_economic', hasQuestion: true })]);
    render(<Risks api={api} />);
    const first = (await screen.findByRole('button', { name: 'Cholera outbreak in Chad spreads to the capital' })).closest('li');
    expect(first).toHaveTextContent('Chad');
    expect(first).toHaveTextContent(THEMES.health);
    expect(first).not.toHaveTextContent('Open question');
    const second = screen.getByRole('button', { name: 'Rail strike in Kenya' }).closest('li');
    expect(second).toHaveTextContent('Open question');
    expect(second).toHaveTextContent(THEMES.political_economic);
  });

  it('the theme and region choices come from the shared vocabulary', async () => {
    const { api } = listing([]);
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    const region = screen.getByLabelText('Region');
    expect([...region.querySelectorAll('option')].map((o) => o.value)).toEqual(['', ...REGIONS]);
    const theme = screen.getByLabelText('Theme');
    expect([...theme.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['All themes', ...Object.values(THEMES)]);
  });

  it('with no filters the query is bare, and each filter adds only its own parameter', async () => {
    const { api, paths, last } = listing([]);
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    expect(paths[0]).toBe('/api/risks');
    await userEvent.type(screen.getByLabelText('Search risks'), 'Chad');
    await waitFor(() => expect(last()).toBe('/api/risks?q=Chad'));
    await userEvent.selectOptions(screen.getByLabelText('Region'), REGIONS[0]);
    await waitFor(() => expect(last()).toBe(`/api/risks?${new URLSearchParams({ q: 'Chad', region: REGIONS[0] })}`));
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'health');
    await waitFor(() => expect(last()).toBe(`/api/risks?${new URLSearchParams({ q: 'Chad', region: REGIONS[0], theme: 'health' })}`));
    await userEvent.type(screen.getByLabelText('Country (ISO3)'), 'tcd');
    await waitFor(() => expect(last()).toBe(`/api/risks?${new URLSearchParams({ q: 'Chad', region: REGIONS[0], theme: 'health', country: 'TCD' })}`));
  });

  it('a cleared filter leaves no empty parameter behind', async () => {
    const { api, last } = listing([]);
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    await userEvent.type(screen.getByLabelText('Search risks'), 'x');
    await waitFor(() => expect(last()).toBe('/api/risks?q=x'));
    await userEvent.clear(screen.getByLabelText('Search risks'));
    await waitFor(() => expect(last()).toBe('/api/risks'));
  });

  it('an empty result says so', async () => {
    render(<Risks api={listing([]).api} />);
    expect(await screen.findByText('No risks match these filters.')).toBeInTheDocument();
  });

  it('a 401 on the search sends the person back through onExpired', async () => {
    const expired = vi.fn();
    render(<Risks api={routes({ 'GET /api/risks': fail(401, 'session invalid or expired') })} onExpired={expired} />);
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed search is an alert', async () => {
    render(<Risks api={routes({ 'GET /api/risks': fail(500, 'the radar file could not be read') })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('the radar file could not be read');
  });

  it('at 200 results it says the list is capped', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ROW({ id: `R${i}`, title: `Risk ${i}` }));
    render(<Risks api={listing(rows).api} />);
    expect(await screen.findByText('Showing the first 200 risks. Narrow your search to see the others.')).toBeInTheDocument();
  });

  it('below 200 results there is no cap note', async () => {
    render(<Risks api={listing([ROW()]).api} />);
    await screen.findByRole('button', { name: /Cholera/ });
    expect(screen.queryByText(/Showing the first 200/)).toBeNull();
  });
});

describe('Risks detail', () => {
  const table = (detail) => ({ 'GET /api/risks': [ROW()], 'GET /api/risks/R1': detail });

  it('a full view shows the type, status, level, probability, impact, rationale and triggers', async () => {
    render(<Risks api={routes(table(FULL))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByRole('heading', { name: 'Rationale' })).toBeInTheDocument();
    expect(screen.getByText('Rainy season and a weak water system raise the odds.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Triggers' })).toBeInTheDocument();
    expect(screen.getByText('Second district reports cases')).toBeInTheDocument();
    for (const v of ['Epidemic', 'Ongoing', 'High', 'Medium', 'Very High']) expect(screen.getByText(v)).toBeInTheDocument();
    expect(screen.queryByText(NEUTRAL_SENTENCE)).toBeNull();
  });

  it('a neutral view shows only the header and the plain sentence', async () => {
    render(<Risks api={routes(table(NEUTRAL))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByText(NEUTRAL_SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: NEUTRAL.title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rationale' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Triggers' })).toBeNull();
  });

  it('a neutral view with no question says the analysis is kept back until a question is resolved', async () => {
    render(<Risks api={routes(table({ ...NEUTRAL, hasQuestion: false }))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByText(NEUTRAL_NO_QUESTION_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByText(NEUTRAL_SENTENCE)).toBeNull();
    expect(screen.queryByText('Open question')).toBeNull();
    expect(screen.getByRole('heading', { name: NEUTRAL.title })).toBeInTheDocument();
  });

  it('never renders restricted fields for a neutral view, even if the payload carries them', async () => {
    const leaky = { ...NEUTRAL, status: 'LEAK-STATUS', outcome: 1, level: 'LEAK-LEVEL', probability: 'LEAK-PROB', impact: 'LEAK-IMPACT', rationale: 'LEAK-RATIONALE SECRET', triggers: [{ id: 'T9', title: 'LEAK-TRIGGER', description: 'LEAK-DESC' }] };
    const { container } = render(<Risks api={routes(table(leaky))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByText(NEUTRAL_SENTENCE);
    expect(container.textContent).not.toMatch(/LEAK|SECRET/);
    expect(container.textContent).not.toMatch(/Ongoing|High|Medium/);
    expect(container.textContent).not.toMatch(/Status|Level|Probability|Impact|Triggers|Rationale/);
  });

  it('never renders restricted fields for a neutral view with no question, even if the payload carries them', async () => {
    const leaky = { ...NEUTRAL, hasQuestion: false, status: 'LEAK-STATUS', outcome: 1, level: 'LEAK-LEVEL', probability: 'LEAK-PROB', impact: 'LEAK-IMPACT', rationale: 'LEAK-RATIONALE SECRET', triggers: [{ id: 'T9', title: 'LEAK-TRIGGER', description: 'LEAK-DESC' }] };
    const { container } = render(<Risks api={routes(table(leaky))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByText(NEUTRAL_NO_QUESTION_SENTENCE);
    expect(container.textContent).not.toMatch(/LEAK|SECRET/);
    expect(container.textContent).not.toMatch(/Ongoing|High|Medium/);
    expect(container.textContent).not.toMatch(/Status|Level|Probability|Impact|Triggers|Rationale/);
  });

  it('a risk with an open question shows the pill on the detail too', async () => {
    render(<Risks api={routes(table({ ...NEUTRAL, hasQuestion: true }))} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByText('Open question')).toBeInTheDocument();
  });

  it('Back returns to the list without searching again', async () => {
    const { api, paths } = listing([ROW()], { 'GET /api/risks/R1': FULL });
    render(<Risks api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByRole('heading', { name: 'Rationale' });
    const before = paths.length;
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(await screen.findByRole('button', { name: /Cholera outbreak/ })).toBeInTheDocument();
    expect(paths.length).toBe(before);
  });

  it('a 401 on the detail sends the person back through onExpired, and a 500 does not', async () => {
    const expired = vi.fn();
    const { api } = listing([ROW()], { 'GET /api/risks/R1': fail(401, 'session invalid or expired') });
    render(<Risks api={api} onExpired={expired} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a server error on the detail is shown, and does not sign anyone out', async () => {
    const expired = vi.fn();
    const { api } = listing([ROW()], { 'GET /api/risks/R1': fail(500, 'the radar is unavailable') });
    render(<Risks api={api} onExpired={expired} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the radar is unavailable');
    expect(expired).not.toHaveBeenCalled();
  });

  it('an unknown risk is an alert, and Back still works', async () => {
    const { api } = listing([ROW()], { 'GET /api/risks/R1': fail(404, 'no such risk') });
    render(<Risks api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no such risk');
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(await screen.findByRole('button', { name: /Cholera outbreak/ })).toBeInTheDocument();
  });

  it('the detail is requested by id, encoded', async () => {
    const detail = vi.fn(() => NEUTRAL);
    const { api } = listing([ROW({ id: 'R 1/2' })], { 'GET /api/risks/R%201%2F2': detail });
    render(<Risks api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await waitFor(() => expect(detail).toHaveBeenCalled());
  });
});

describe('Risks timeline', () => {
  const TIMELINE = {
    riskTrend: 'Deteriorated',
    rationaleUpdates: [{ date: '2026-03-03', text: 'Timeline rationale update.' }],
    triggers: [{ id: 'T1', title: 'Second district reports cases', completion: [{ date: '2026-03-03', value: 55 }], trend: [{ date: '2026-03-03', value: 'Improved' }], dateEntered: '2026-03-03', lastUpdate: '2026-03-03', movement: { completion: 'none', trend: 'none' } }],
    span: { from: '2026-03-03', to: '2026-03-03' },
    points: 2,
  };
  const TIMELINE_HEADING = 'How this risk has been recorded to change';
  const TIMELINE_CAPTION = 'Dates and values as recorded by ACAPS analysts. Completion rate is a judgement whose meaning has not been standardised.';
  const LEAK_TIMELINE = {
    riskTrend: 'LEAK-TREND',
    rationaleUpdates: [{ date: '2026-03-03', text: 'LEAK-UPDATE text' }],
    triggers: [{ id: 'X', title: 'LEAK-TRIGGER', completion: [{ date: '2026-03-03', value: 88 }], trend: [{ date: '2026-03-03', value: 'Improved' }], dateEntered: '2026-03-03', lastUpdate: '2026-03-03', movement: { completion: 'none', trend: 'none' } }],
    span: null,
    points: 2,
  };

  const detailFor = (detail) => routes({ 'GET /api/risks': [ROW()], 'GET /api/risks/R1': detail });

  it('the full view shows the timeline with its caption', async () => {
    render(<Risks api={detailFor({ ...FULL, timeline: TIMELINE })} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(await screen.findByRole('heading', { name: TIMELINE_HEADING })).toBeInTheDocument();
    expect(screen.getByText(TIMELINE_CAPTION)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Completion rate: Second district reports cases' })).toBeInTheDocument();
  });

  it('a full view with no timeline shows no timeline section', async () => {
    render(<Risks api={detailFor(FULL)} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByRole('heading', { name: 'Rationale' });
    expect(screen.queryByRole('heading', { name: TIMELINE_HEADING })).toBeNull();
  });

  it('a neutral payload that carries a timeline renders no timeline text', async () => {
    const { container } = render(<Risks api={detailFor({ ...NEUTRAL, timeline: LEAK_TIMELINE })} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByText(NEUTRAL_SENTENCE);
    expect(screen.queryByRole('heading', { name: TIMELINE_HEADING })).toBeNull();
    expect(screen.queryByText(TIMELINE_CAPTION)).toBeNull();
    expect(container.textContent).not.toMatch(/LEAK|How this risk has been recorded|Rationale updates/);
  });

  it('a neutral view with no question renders no timeline text, even if the payload carries one', async () => {
    const { container } = render(<Risks api={detailFor({ ...NEUTRAL, hasQuestion: false, timeline: LEAK_TIMELINE })} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByText(NEUTRAL_NO_QUESTION_SENTENCE);
    expect(container.textContent).not.toMatch(/LEAK|How this risk has been recorded|Rationale updates/);
  });
});
