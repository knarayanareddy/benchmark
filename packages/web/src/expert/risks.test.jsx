import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Risks } from './Risks.jsx';
import { routes, fail } from '../test-helpers.js';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';

const LOCKED_ROW = (over = {}) => ({ id: 'R1', title: 'Cholera outbreak in Chad spreads to the capital', country: 'Chad', region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic', hasQuestion: false, liveQuestions: 0, answered: null, ...over });
const FULL_ROW = (over = {}) => LOCKED_ROW({ level: 'High', probability: 'Medium', status: 'Active', ...over });
const HISTORY_ROW = (over = {}) => FULL_ROW({ id: 'R2', title: 'Rail strike in Kenya', country: 'Kenya', status: 'Materialised', level: 'Medium', probability: 'Low', ...over });

const LOCK_ANSWER_HEAD = 'Locked until you give your own estimate';
const DEVICE_SENTENCE = 'Your device holds your answers, so open the question to unlock this.';
const CLOSED_HEAD = 'Locked until the question is resolved';

const NEUTRAL = { view: 'neutral', hasQuestion: true, lock: 'answer', question: { id: 'C1', open: true, answered: false }, id: 'R1', title: 'Cholera outbreak in Chad spreads to the capital', country: 'Chad', isos: ['TCD'], region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic' };
const FULL = { view: 'full', hasQuestion: false, question: null, id: 'R1', title: 'Cholera outbreak in Chad spreads to the capital', country: 'Chad', isos: ['TCD'], region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic', status: 'Materialised', outcome: 1, level: 'High', probability: 'Medium', impact: 'Very High', rationale: 'Rainy season and a weak water system raise the odds.', triggers: [{ id: 'T1', title: 'Second district reports cases', description: 'Two or more districts within a week.' }] };
const RELEASE = { n: 6, estimate: 0.48, lo: 0.3, hi: 0.8, suppressed: false };

/**
 * The list and the detail. The list handler answers each tab from its own rows, so the counts and the list agree.
 * Every path asked for is recorded.
 */
function listing({ active = [], history = [], ...extra } = {}) {
  const paths = [];
  const api = routes({
    'GET /api/risks': (_b, path) => {
      paths.push(path);
      return new URL(path, 'http://x').searchParams.get('view') === 'history' ? history : active;
    },
    ...extra,
  });
  return { api, paths, last: () => paths[paths.length - 1] };
}

describe('Risks list', () => {
  it('lists each risk with its country, theme and, where it is visible, its level', async () => {
    const { api } = listing({ active: [FULL_ROW(), LOCKED_ROW({ id: 'R2', title: 'Rail strike in Kenya', country: 'Kenya', theme: 'political_economic', hasQuestion: true, liveQuestions: 1 })] });
    render(<Risks api={api} />);
    const first = (await screen.findByRole('button', { name: /Cholera outbreak/ }));
    expect(first).toHaveTextContent('Chad');
    expect(first).toHaveTextContent(THEMES.health);
    expect(first).toHaveTextContent('High');
    const second = screen.getByRole('button', { name: /Rail strike in Kenya/ });
    expect(second).toHaveTextContent(THEMES.political_economic);
    expect(second).not.toHaveTextContent('High');
  });

  it('the level pill is toned: High and Very High rose, Medium amber, Low plain', async () => {
    const { api } = listing({ active: [FULL_ROW({ id: 'A', title: 'A risk', level: 'High' }), FULL_ROW({ id: 'B', title: 'B risk', level: 'Medium' }), FULL_ROW({ id: 'C', title: 'C risk', level: 'Low' })] });
    render(<Risks api={api} />);
    await screen.findByRole('button', { name: /A risk/ });
    // The pills of a card, in order: country, level, theme.
    const pill = (name) => screen.getByRole('button', { name: new RegExp(name) }).querySelectorAll('.pill')[1];
    expect(pill('A risk')).toHaveClass('rose');
    expect(pill('B risk')).toHaveClass('amber');
    expect(pill('C risk')).not.toHaveClass('rose');
    expect(pill('C risk')).not.toHaveClass('amber');
  });

  it('a risk with a live question shows how many, and whether you answered it; a risk with none says so', async () => {
    const { api } = listing({ active: [LOCKED_ROW({ id: 'L', title: 'Locked one', hasQuestion: true, liveQuestions: 2, answered: false }), FULL_ROW({ id: 'D', title: 'Answered one', hasQuestion: true, liveQuestions: 1, answered: true }), FULL_ROW({ id: 'N', title: 'Quiet one' })] });
    render(<Risks api={api} />);
    expect(await screen.findByText(/Locked one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Locked one/ })).toHaveTextContent('2 live questions · answer to reveal');
    expect(screen.getByRole('button', { name: /Answered one/ })).toHaveTextContent('1 live question · you answered');
    expect(screen.getByRole('button', { name: /Quiet one/ })).toHaveTextContent('No question open on this risk');
  });

  it('a locked row shows no level, status or probability', async () => {
    const { api } = listing({ active: [LOCKED_ROW({ id: 'L', title: 'Locked one', hasQuestion: true, liveQuestions: 1, answered: false })] });
    render(<Risks api={api} />);
    const card = await screen.findByRole('button', { name: /Locked one/ });
    expect(card.textContent).not.toMatch(/Active|Materialised|ACAPS rated|High|Medium|Low/);
  });

  it('starts on Active, asks for that tab, and shows the count from each tab', async () => {
    const { api, paths } = listing({ active: [FULL_ROW()], history: [HISTORY_ROW(), HISTORY_ROW({ id: 'R3', title: 'Second past one' })] });
    render(<Risks api={api} />);
    await screen.findByRole('button', { name: /Cholera outbreak/ });
    expect(paths).toContain('/api/risks?view=active');
    expect(screen.getByRole('button', { name: 'Active (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'History · how ACAPS did (2)' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'History · how ACAPS did (2)' }));
    expect(await screen.findByRole('button', { name: /Rail strike in Kenya/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cholera outbreak/ })).toBeNull();
    expect(paths).toContain('/api/risks?view=history');
    expect(screen.getByRole('button', { name: 'History · how ACAPS did (2)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a History row shows its status pill and the ACAPS probability, not the live-question line', async () => {
    const { api } = listing({ history: [HISTORY_ROW(), HISTORY_ROW({ id: 'R3', title: 'Not in the end', status: 'Not materialised', probability: null })] });
    render(<Risks api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /History · how ACAPS did/ }));
    const materialised = await screen.findByRole('button', { name: /Rail strike in Kenya/ });
    expect(materialised).toHaveTextContent('Materialised');
    expect(materialised).toHaveTextContent('ACAPS rated probability: Low');
    expect(materialised.querySelector('.pill.rose')).toHaveTextContent('Materialised');
    const notMaterialised = screen.getByRole('button', { name: /Not in the end/ });
    expect(notMaterialised).toHaveTextContent('Not materialised');
    expect(notMaterialised).toHaveTextContent('ACAPS rated probability: unrated');
    expect(notMaterialised.querySelector('.pill.green')).toHaveTextContent('Not materialised');
  });

  it('the theme and region choices come from the shared vocabulary', async () => {
    const { api } = listing();
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    const region = screen.getByLabelText('Region');
    expect([...region.querySelectorAll('option')].map((o) => o.value)).toEqual(['', ...REGIONS]);
    const theme = screen.getByLabelText('Theme');
    expect([...theme.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['All themes', ...Object.values(THEMES)]);
  });

  it('with no filters the query is only the tab, and each filter adds only its own parameter', async () => {
    const { api, paths, last } = listing();
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    expect(paths).toContain('/api/risks?view=active');
    await userEvent.type(screen.getByLabelText('Search risks'), 'Chad');
    await waitFor(() => expect(last()).toBe('/api/risks?view=active&q=Chad'));
    await userEvent.selectOptions(screen.getByLabelText('Region'), REGIONS[0]);
    await waitFor(() => expect(last()).toBe(`/api/risks?${new URLSearchParams({ view: 'active', q: 'Chad', region: REGIONS[0] })}`));
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'health');
    await waitFor(() => expect(last()).toBe(`/api/risks?${new URLSearchParams({ view: 'active', q: 'Chad', region: REGIONS[0], theme: 'health' })}`));
    await userEvent.type(screen.getByLabelText('Country (ISO3)'), 'tcd');
    await waitFor(() => expect(last()).toBe(`/api/risks?${new URLSearchParams({ view: 'active', q: 'Chad', region: REGIONS[0], theme: 'health', country: 'TCD' })}`));
  });

  it('the filters apply to the tab on screen', async () => {
    const { api, last } = listing({ history: [] });
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    await userEvent.click(screen.getByRole('button', { name: /History · how ACAPS did/ }));
    await userEvent.type(screen.getByLabelText('Search risks'), 'x');
    await waitFor(() => expect(last()).toBe('/api/risks?view=history&q=x'));
  });

  it('a cleared filter leaves no empty parameter behind', async () => {
    const { api, last } = listing();
    render(<Risks api={api} />);
    await screen.findByText('No risks match these filters.');
    await userEvent.type(screen.getByLabelText('Search risks'), 'x');
    await waitFor(() => expect(last()).toBe('/api/risks?view=active&q=x'));
    await userEvent.clear(screen.getByLabelText('Search risks'));
    await waitFor(() => expect(last()).toBe('/api/risks?view=active'));
  });

  it('an empty result says so', async () => {
    render(<Risks api={listing().api} />);
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
    const rows = Array.from({ length: 200 }, (_, i) => LOCKED_ROW({ id: `R${i}`, title: `Risk ${i}` }));
    render(<Risks api={listing({ active: rows }).api} />);
    expect(await screen.findByText('Showing the first 200 risks. Narrow your search to see the others.')).toBeInTheDocument();
  });

  it('below 200 results there is no cap note', async () => {
    render(<Risks api={listing({ active: [LOCKED_ROW()] }).api} />);
    await screen.findByRole('button', { name: /Cholera/ });
    expect(screen.queryByText(/Showing the first 200/)).toBeNull();
  });
});

describe('Risks detail', () => {
  const table = (detail, extra = {}) => ({ 'GET /api/risks': [LOCKED_ROW()], 'GET /api/risks/R1': detail, ...extra });
  const open = async () => userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));

  it('a full view shows the analysis, its probability and impact, and the triggers, in the prototype order', async () => {
    render(<Risks api={routes(table(FULL, { 'GET /api/cards/C1/release': RELEASE }))} />);
    await open();
    expect(await screen.findByRole('heading', { name: 'ACAPS analysis' })).toBeInTheDocument();
    expect(screen.getByText('Rainy season and a weak water system raise the odds.')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Very High')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Triggers for deterioration' })).toBeInTheDocument();
    expect(screen.getByText('Second district reports cases')).toBeInTheDocument();
    expect(screen.queryByText(LOCK_ANSWER_HEAD)).toBeNull();
  });

  it('the full view lists its sections in the prototype order: ACAPS analysis, Triggers, Circle view', async () => {
    render(<Risks api={routes(table({ ...FULL, question: { id: 'C1', open: false, answered: true } }, { 'GET /api/cards/C1/release': RELEASE }))} />);
    await open();
    await screen.findByText('Rainy season and a weak water system raise the odds.');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['ACAPS analysis', 'Triggers for deterioration', 'Circle view']);
  });

  it('the header of a full view carries the level, trend and status, in the prototype order', async () => {
    render(<Risks api={routes(table({ ...FULL, timeline: { riskTrend: 'Deteriorated', rationaleUpdates: [], triggers: [], span: null, points: 0 } }))} />);
    await open();
    await screen.findByRole('heading', { name: 'ACAPS analysis' });
    const pills = [...document.querySelectorAll('.risk-head .pill')].map((p) => p.textContent);
    expect(pills).toEqual(['Chad', THEMES.health, 'R1', 'High risk', 'Deteriorated', 'Materialised']);
  });

  it('a full view with a circle shows the released figure, with its range and panel size', async () => {
    const release = vi.fn(() => RELEASE);
    render(<Risks api={routes(table({ ...FULL, question: { id: 'C1', open: false, answered: true } }, { 'GET /api/cards/C1/release': release }))} />);
    await open();
    expect(await screen.findByText('48%')).toBeInTheDocument();
    expect(screen.getByText(/Circle range 30%–80%/)).toBeInTheDocument();
    expect(screen.getByText(/n=6/)).toBeInTheDocument();
    expect(release).toHaveBeenCalled();
  });

  it('a full view whose circle is not released says so in words, with the real threshold', async () => {
    render(<Risks api={routes(table({ ...FULL, question: { id: 'C1', open: false, answered: true } }, { 'GET /api/cards/C1/release': { n: 2, estimate: null, lo: null, hi: null, suppressed: true } }))} />);
    await open();
    expect(await screen.findByText('Hidden until ≥ 5 members answer.')).toBeInTheDocument();
  });

  it('a full view with no question has no Circle view', async () => {
    render(<Risks api={routes(table(FULL))} />);
    await open();
    await screen.findByRole('heading', { name: 'ACAPS analysis' });
    expect(screen.queryByRole('heading', { name: 'Circle view' })).toBeNull();
  });

  it('the locked view shows only the header, the lock box and the circle line, and asks for no release', async () => {
    const api = routes({ 'GET /api/risks': [LOCKED_ROW()], 'GET /api/risks/R1': NEUTRAL, 'GET /api/cards/C1/release': RELEASE });
    render(<Risks api={api} />);
    await open();
    expect(await screen.findByRole('heading', { name: LOCK_ANSWER_HEAD })).toBeInTheDocument();
    expect(screen.getByText("Independence first: reading others' arguments before committing anchors everyone. It takes about 90 seconds.")).toBeInTheDocument();
    expect(screen.getByText('If this question is put to you, answer it under Questions to unlock the analysis.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Circle view' })).toBeInTheDocument();
    expect(screen.getByText('Revealed after you give your own estimate.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ACAPS analysis' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Triggers for deterioration' })).toBeNull();
    expect(api.mock.calls.map((c) => `${c[0]} ${c[1]}`)).not.toContain('GET /api/cards/C1/release');
  });

  it('a locked view renders no restricted text, even when the payload carries it', async () => {
    const leaky = { ...NEUTRAL, status: 'LEAK-STATUS', outcome: 1, level: 'LEAK-LEVEL', probability: 'LEAK-PROB', impact: 'LEAK-IMPACT', rationale: 'LEAK-RATIONALE SECRET', triggers: [{ id: 'T9', title: 'LEAK-TRIGGER', description: 'LEAK-DESC' }], timeline: { riskTrend: 'LEAK-TREND', rationaleUpdates: [{ date: '2026-03-03', text: 'LEAK-UPDATE' }], triggers: [], span: null, points: 0 } };
    const { container } = render(<Risks api={routes(table(leaky))} />);
    await open();
    await screen.findByRole('heading', { name: LOCK_ANSWER_HEAD });
    expect(container.textContent).not.toMatch(/LEAK|SECRET/);
    expect(container.textContent).not.toMatch(/Ongoing|Active|High|Medium|Very High|Deteriorated|Materialised/);
    expect(container.textContent).not.toMatch(/Status|Level|Probability|Impact|Triggers|Rationale|ACAPS analysis|How this risk has been recorded/);
  });

  it('a device-held lock says the device holds the answers, and does not promise a simple unlock', async () => {
    render(<Risks api={routes(table({ ...NEUTRAL, lock: 'device', question: { id: 'C1', open: true, answered: null } }))} />);
    await open();
    expect(await screen.findByRole('heading', { name: LOCK_ANSWER_HEAD })).toBeInTheDocument();
    expect(screen.getByText(DEVICE_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByText('If this question is put to you, answer it under Questions to unlock the analysis.')).toBeNull();
  });

  it('a question that has closed unanswered locks with words that do not promise an answer', async () => {
    render(<Risks api={routes(table({ ...NEUTRAL, lock: 'closed', question: { id: 'C1', open: false, answered: false } }))} />);
    await open();
    expect(await screen.findByRole('heading', { name: CLOSED_HEAD })).toBeInTheDocument();
    expect(screen.getByText('A question on this risk has closed. Its analysis opens once it is resolved.')).toBeInTheDocument();
    expect(screen.getByText('Revealed once the question is resolved.')).toBeInTheDocument();
    expect(screen.queryByText(/answer it under Questions/)).toBeNull();
  });

  it('a locked header has no level, trend or status, only the country, theme and id', async () => {
    render(<Risks api={routes(table(NEUTRAL))} />);
    await open();
    await screen.findByRole('heading', { name: LOCK_ANSWER_HEAD });
    const pills = [...document.querySelectorAll('.risk-head .pill')].map((p) => p.textContent);
    expect(pills).toEqual(['Chad', THEMES.health, 'R1']);
  });

  it('Back returns to the list without searching again', async () => {
    const { api, paths } = listing({ active: [LOCKED_ROW()], 'GET /api/risks/R1': FULL });
    render(<Risks api={api} />);
    await open();
    await screen.findByRole('heading', { name: 'ACAPS analysis' });
    const before = paths.length;
    await userEvent.click(screen.getByRole('button', { name: '← Risks' }));
    expect(await screen.findByRole('button', { name: /Cholera outbreak/ })).toBeInTheDocument();
    expect(paths.length).toBe(before);
  });

  it('a 401 on the detail sends the person back through onExpired, and a 500 does not', async () => {
    const expired = vi.fn();
    const { api } = listing({ active: [LOCKED_ROW()], 'GET /api/risks/R1': fail(401, 'session invalid or expired') });
    render(<Risks api={api} onExpired={expired} />);
    await open();
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a server error on the detail is shown, and does not sign anyone out', async () => {
    const expired = vi.fn();
    const { api } = listing({ active: [LOCKED_ROW()], 'GET /api/risks/R1': fail(500, 'the radar is unavailable') });
    render(<Risks api={api} onExpired={expired} />);
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('the radar is unavailable');
    expect(expired).not.toHaveBeenCalled();
  });

  it('an unknown risk is an alert, and Back still works', async () => {
    const { api } = listing({ active: [LOCKED_ROW()], 'GET /api/risks/R1': fail(404, 'no such risk') });
    render(<Risks api={api} />);
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('no such risk');
    await userEvent.click(screen.getByRole('button', { name: '← Risks' }));
    expect(await screen.findByRole('button', { name: /Cholera outbreak/ })).toBeInTheDocument();
  });

  it('the detail is requested by id, encoded', async () => {
    const detail = vi.fn(() => NEUTRAL);
    const { api } = listing({ active: [LOCKED_ROW({ id: 'R 1/2' })], 'GET /api/risks/R%201%2F2': detail });
    render(<Risks api={api} />);
    await open();
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

  const detailFor = (detail) => routes({ 'GET /api/risks': [LOCKED_ROW()], 'GET /api/risks/R1': detail });

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
    await screen.findByRole('heading', { name: 'ACAPS analysis' });
    expect(screen.queryByRole('heading', { name: TIMELINE_HEADING })).toBeNull();
  });

  it('a locked payload that carries a timeline renders no timeline text', async () => {
    const { container } = render(<Risks api={detailFor({ ...NEUTRAL, timeline: LEAK_TIMELINE })} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByRole('heading', { name: LOCK_ANSWER_HEAD });
    expect(screen.queryByRole('heading', { name: TIMELINE_HEADING })).toBeNull();
    expect(screen.queryByText(TIMELINE_CAPTION)).toBeNull();
    expect(container.textContent).not.toMatch(/LEAK|How this risk has been recorded|Rationale updates/);
  });

  it('a closed-question lock renders no timeline text either', async () => {
    const { container } = render(<Risks api={detailFor({ ...NEUTRAL, lock: 'closed', question: { id: 'C1', open: false, answered: false }, timeline: LEAK_TIMELINE })} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cholera outbreak/ }));
    await screen.findByRole('heading', { name: CLOSED_HEAD });
    expect(container.textContent).not.toMatch(/LEAK|How this risk has been recorded|Rationale updates/);
  });
});
