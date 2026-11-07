import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dispatch } from './Dispatch.jsx';
import { routes, fail } from '../test-helpers.js';
import { REGIONS } from '@benchmark/core/taxonomy';

const listed = [
  { id: 'R1', title: 'Cholera spreads in Chad', country: 'Chad', region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic', hasQuestion: true },
  { id: 'R2', title: 'Drought in Kenya', country: 'Kenya', region: 'East & Southern Africa', theme: 'climate', riskType: 'Hazard', hasQuestion: false },
];
const full = {
  view: 'full', hasQuestion: true, id: 'R1', title: 'Cholera spreads in Chad', country: 'Chad', isos: ['TCD'], region: 'Sahel & West/Central Africa', theme: 'health', riskType: 'Epidemic',
  status: 'Ongoing', outcome: null, level: 'High', probability: 'High', impact: 'Severe', rationale: 'Rainy season and camp crowding.', triggers: [{ id: 'T1', title: 'Flood warning', description: 'Rivers above the danger mark.' }],
};
const noRating = { ...full, id: 'R2', title: 'Drought in Kenya', country: 'Kenya', isos: ['KEN'], region: '', theme: 'climate', probability: '', triggers: [] };

const pickRisk = async (title) => userEvent.click((await screen.findByRole('button', { name: new RegExp(title) })));

describe('risk search', () => {
  it('lists risks at load and builds the query from the search box and the selects', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks?q=chad&region=Sahel+%26+West%2FCentral+Africa&theme=health': [listed[0]] });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    expect(await screen.findByRole('button', { name: /Drought in Kenya/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search risks'), 'chad');
    await userEvent.selectOptions(screen.getByLabelText('Region'), 'Sahel & West/Central Africa');
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'health');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('GET', '/api/risks?q=chad&region=Sahel+%26+West%2FCentral+Africa&theme=health'));
    expect(await screen.findByRole('button', { name: /Cholera spreads in Chad/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drought in Kenya/ })).toBeNull();
  });

  it('marks a risk with a live question, and says when nothing matches', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks?q=zzz': [] });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    const row = (await screen.findByText('Cholera spreads in Chad')).closest('button');
    expect(within(row).getByText('Open question')).toBeInTheDocument();
    expect(within(screen.getByText('Drought in Kenya').closest('button')).queryByText('Open question')).toBeNull();
    await userEvent.type(screen.getByLabelText('Search risks'), 'zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No risks match.')).toBeInTheDocument();
  });

  it('a failed search is shown in role=alert', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks?q=boom': fail(500, 'radar unavailable') });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await screen.findByRole('button', { name: /Drought in Kenya/ });
    await userEvent.type(screen.getByLabelText('Search risks'), 'boom');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('radar unavailable');
  });
});

describe('selecting a risk', () => {
  it('shows the full ACAPS analysis from GET /api/risks/:id', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks/R1': full });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await pickRisk('Cholera spreads in Chad');
    expect(a).toHaveBeenCalledWith('GET', '/api/risks/R1');
    const detail = (await screen.findByRole('heading', { name: 'Cholera spreads in Chad', level: 3 })).closest('.card');
    expect(within(detail).getByText('Ongoing')).toBeInTheDocument();
    expect(within(detail).getByText('Severe')).toBeInTheDocument();
    expect(within(detail).getByText('Rainy season and camp crowding.')).toBeInTheDocument();
    expect(within(detail).getByText('Flood warning')).toBeInTheDocument();
    expect(within(detail).getAllByText('High', { selector: 'dd' })).toHaveLength(2);
  });

  it('a failed load of the risk is shown, not the previous analysis', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks/R1': full, 'GET /api/risks/R2': fail(404, 'no such risk') });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await pickRisk('Cholera spreads in Chad');
    await screen.findByRole('heading', { name: 'Cholera spreads in Chad', level: 3 });
    await pickRisk('Drought in Kenya');
    expect(await screen.findByRole('alert')).toHaveTextContent('no such risk');
    expect(screen.queryByRole('heading', { name: 'Cholera spreads in Chad', level: 3 })).toBeNull();
  });
});

describe('drafting a card from a risk', () => {
  it('hands the mapped fields to the Cards form, then opens the Cards tab', async () => {
    const setDraft = vi.fn();
    const goto = vi.fn();
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks/R1': full });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} setDraft={setDraft} goto={goto} />);
    await pickRisk('Cholera spreads in Chad');
    await userEvent.click(await screen.findByRole('button', { name: 'Draft a card from this risk' }));
    // The theme is left blank for the moderator to choose; the rationale and triggers never leave the risk.
    expect(setDraft).toHaveBeenCalledWith({
      riskId: 'R1', riskTitle: 'Cholera spreads in Chad', country: 'TCD', region: 'Sahel & West/Central Africa', theme: '', probability: 'High',
    });
    expect(JSON.stringify(setDraft.mock.calls[0][0])).not.toContain('Rainy season');
    expect(goto).toHaveBeenCalledWith('cards');
    expect(setDraft.mock.invocationCallOrder[0]).toBeLessThan(goto.mock.invocationCallOrder[0]);
  });

  it('leaves the rating blank when ACAPS has no band the card form knows, blanks an unknown region, and never copies the derived theme', async () => {
    const setDraft = vi.fn();
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks/R2': noRating });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} setDraft={setDraft} goto={() => {}} />);
    await pickRisk('Drought in Kenya');
    await userEvent.click(await screen.findByRole('button', { name: 'Draft a card from this risk' }));
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ riskId: 'R2', country: 'KEN', region: '', theme: '', probability: '' }));
  });
});

describe('preview who would be asked', () => {
  const preview = {
    card: { id: null, country: 'TCD', region: 'Sahel & West/Central Africa', theme: 'health' },
    counts: { ask: 1, radar: 1, outside: 1, answered: 1 },
    rows: [
      { label: 'Amina Okoro', level: 'identified', why: [{ label: 'Covers Chad' }, { label: 'Theme match' }], decision: 'ask', reason: 'Covers Chad, Theme match' },
      { label: 'Anonymous expert', level: 'anonymous', why: [{ label: 'The circle needs more views' }], decision: 'radar', reason: 'The circle needs more views (older than a week)' },
      { label: 'Anonymous expert', level: 'anonymous', why: [], decision: 'outside', reason: 'Not in their declaration' },
      { label: 'Ruth', level: 'pseudonymous', why: [], decision: 'answered', reason: 'Answered in Round 1' },
    ],
  };

  it('posts a draft (country, region, theme) and renders the counts and the rows', async () => {
    const a = routes({
      'GET /api/risks': listed, 'GET /api/staff/cards': [],
      'POST /api/staff/dispatch/preview': (b) => { expect(b).toEqual({ draft: { country: 'TCD', region: 'Sahel & West/Central Africa', theme: 'health' } }); expect(Object.keys(b)).toEqual(['draft']); return preview; },
    });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await userEvent.type(await screen.findByLabelText('Country (ISO code)'), 'TCD');
    await userEvent.selectOptions(screen.getByLabelText('Region (optional)'), 'Sahel & West/Central Africa');
    await userEvent.selectOptions(screen.getByLabelText('Theme (optional)'), 'health');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Would be asked: 1. On radar, not pushed: 1. Outside what they cover: 1. Already answered: 1.');
    const rows = screen.getByRole('table');
    expect(rows).toHaveClass('stack');
    const amina = within(rows).getByText('Amina Okoro').closest('tr');
    expect(within(amina).getByText('Identified')).toBeInTheDocument();
    expect(within(amina).getByText('Covers Chad')).toBeInTheDocument();
    expect(within(amina).getByText('Theme match')).toBeInTheDocument();
    // The chips say why; the same words are not repeated as text beside them.
    expect(within(amina).getByText('Covers Chad')).toBeInTheDocument();
    expect(within(amina).getByText('Theme match')).toBeInTheDocument();
    expect(within(amina).queryByText('Covers Chad, Theme match')).toBeNull();
    expect(within(amina).getByText('Asked', { selector: '.pill' })).toBeInTheDocument();
    const anons = within(rows).getAllByText('Anonymous expert');
    expect(anons).toHaveLength(2);
    expect(within(anons[0].closest('tr')).getByText('On their radar', { selector: '.pill' })).toBeInTheDocument();
    expect(within(anons[1].closest('tr')).getByText('Outside what they cover', { selector: '.pill' })).toBeInTheDocument();
    expect(within(rows).getByText('Already answered', { selector: '.pill' })).toBeInTheDocument();
    expect(screen.getByText('Anonymous experts appear only as “Anonymous expert”, and “already answered” is never checked for them, so their rows show only what their declaration would offer.')).toBeInTheDocument();
  });

  it('shows no score: four columns, no score heading, no score number', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'POST /api/staff/dispatch/preview': preview });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    const rows = await screen.findByRole('table');
    expect(within(rows).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Expert', 'Level', 'Reasons', 'Decision']);
    for (const tr of within(rows).getAllByRole('row').slice(1)) expect(within(tr).getAllByRole('cell')).toHaveLength(4);
    expect(document.body.textContent).not.toMatch(/score/i);
    expect(document.body.textContent).not.toMatch(/\b(85|22|10)\b/);
  });

  it('posts an existing card as cardId only, and disables the draft fields', async () => {
    const a = routes({
      'GET /api/risks': listed,
      'GET /api/staff/cards': [{ id: 'C1', statement: 'Cholera in Chad', status: 'open', round: 1, responses: 0 }],
      'POST /api/staff/dispatch/preview': (b) => { expect(b).toEqual({ cardId: 'C1' }); expect(Object.keys(b)).toEqual(['cardId']); return { ...preview, card: { id: 'C1', country: 'TCD', region: 'Sahel & West/Central Africa', theme: 'health' } }; },
    });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    const select = await screen.findByLabelText('Existing card');
    await screen.findByRole('option', { name: /C1: Cholera in Chad/ });
    await userEvent.selectOptions(select, 'C1');
    expect(screen.getByLabelText('Country (ISO code)')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Amina Okoro')).toBeInTheDocument();
  });

  it('pre-fills the draft fields from the Cards hand-off', async () => {
    const draft = { riskId: 'R1', riskTitle: 'Cholera spreads in Chad', country: 'TCD', region: 'Sahel & West/Central Africa', theme: 'health', probability: 'High' };
    render(<Dispatch api={routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [] })} me={{ id: 'm', role: 'moderator' }} draft={draft} />);
    expect(await screen.findByLabelText('Country (ISO code)')).toHaveValue('TCD');
    expect(screen.getByLabelText('Region (optional)')).toHaveValue('Sahel & West/Central Africa');
    expect(screen.getByLabelText('Theme (optional)')).toHaveValue('health');
  });

  it('a server refusal is shown in role=alert', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'POST /api/staff/dispatch/preview': fail(400, 'a country is required') });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a country is required');
  });

  it('never shows an expert id, organisation or role type, even if the service sent one', async () => {
    const leaky = {
      ...preview,
      rows: [{ ...preview.rows[0], expertId: 'ex_leak_4411', organisation: 'Secret Relief Org', roleType: 'local_ngo', respondentKey: 'rk_leak_9' }, preview.rows[1]],
    };
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'POST /api/staff/dispatch/preview': leaky });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByText('Amina Okoro');
    const text = document.body.textContent;
    for (const secret of ['ex_leak_4411', 'Secret Relief Org', 'local_ngo', 'Local NGO leader', 'rk_leak_9']) expect(text).not.toContain(secret);
  });
});

describe('timeline in the staff risk detail', () => {
  const TIMELINE = {
    riskTrend: null,
    rationaleUpdates: [{ date: '2026-03-03', text: 'Staff rationale update.' }],
    triggers: [{ id: 'T1', title: 'Flood warning', completion: [{ date: '2026-03-03', value: 40 }], trend: [], dateEntered: '2026-03-03', lastUpdate: '2026-03-03', movement: { completion: 'none', trend: 'none' } }],
    span: null,
    points: 1,
  };

  it('shows the timeline under the analysis when the detail carries one', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks/R1': { ...full, timeline: TIMELINE } });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await pickRisk('Cholera spreads in Chad');
    const detail = (await screen.findByRole('heading', { name: 'Cholera spreads in Chad', level: 3 })).closest('.card');
    expect(within(detail).getByRole('heading', { name: 'How this risk has been recorded to change' })).toBeInTheDocument();
    expect(within(detail).getByText('Staff rationale update.')).toBeInTheDocument();
  });

  it('shows no timeline when the detail has none', async () => {
    const a = routes({ 'GET /api/risks': listed, 'GET /api/staff/cards': [], 'GET /api/risks/R1': full });
    render(<Dispatch api={a} me={{ id: 'm', role: 'moderator' }} />);
    await pickRisk('Cholera spreads in Chad');
    await screen.findByRole('heading', { name: 'Cholera spreads in Chad', level: 3 });
    expect(screen.queryByRole('heading', { name: 'How this risk has been recorded to change' })).toBeNull();
  });
});
