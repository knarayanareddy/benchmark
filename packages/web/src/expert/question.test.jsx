import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardView, resetLevelCache } from './CardView.jsx';
import { routes, fail, blindServer, card, json } from '../test-helpers.js';
import { createSecret } from '../lib/device.js';
import { pending } from '../lib/queue.js';
import { ApiError } from '../lib/api.js';
import { LEVEL_COPY } from '@benchmark/core/anonymity';

const PROFILE = { 'GET /api/me/profile': { level: 'pseudonymous' } };
const RESOLUTION = { objective: 'The WHO count exceeds 10,000 cases.', source: 'WHO situation reports', resolver: 'the ACAPS panel lead' };
const REVISION = { round: 2, yourEstimate: 0.2, release: null };

const slider = () => screen.getByRole('slider', { name: /probability/i });
const lock = () => screen.getByRole('button', { name: 'Lock in my estimate' });
const reasonBox = () => screen.getByLabelText(/^Why\?/);
const group = (name) => screen.getByRole('group', { name });
const chip = (name, label) => within(group(name)).getByRole('button', { name: label });
const coi = () => screen.getByRole('checkbox', { name: /funding or position/ });

beforeEach(() => { window.history.replaceState(null, '', '/'); resetLevelCache(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('the question card header and resolution', () => {
  it('discloses how the question resolves once the details are opened', async () => {
    const { container } = render(<CardView api={routes(PROFILE)} card={card({ resolution: RESOLUTION })} mode="server" onNext={() => {}} />);
    const details = container.querySelector('details.resolution');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('How this will be resolved'));
    expect(details).toHaveAttribute('open');
    expect(details).toHaveTextContent('It counts as “yes” if: The WHO count exceeds 10,000 cases.');
    expect(details).toHaveTextContent('Checked against: WHO situation reports · decided by the ACAPS panel lead');
    expect(details).toHaveTextContent('Window: 2026-11-01 to 2027-04-30');
  });

  it('with no resolution the details still show the window, and nothing about the objective or source', () => {
    const { container } = render(<CardView api={routes(PROFILE)} card={card({ resolution: null })} mode="server" onNext={() => {}} />);
    expect(container.querySelector('details.resolution')).not.toBeNull();
    expect(container.querySelector('details.resolution')).toHaveTextContent('Window: 2026-11-01 to 2027-04-30');
    expect(screen.queryByText(/It counts as/)).toBeNull();
    expect(screen.queryByText(/Checked against/)).toBeNull();
  });

  it('the blind-round notice is shown in Round 1 and not in a revision', () => {
    const { unmount } = render(<CardView api={routes(PROFILE)} card={card()} mode="server" onNext={() => {}} />);
    expect(screen.getByText(/Blind round: ACAPS’s rating and the circle’s views are hidden until you answer\./)).toBeInTheDocument();
    unmount();
    render(<CardView api={routes(PROFILE)} card={card(REVISION)} mode="server" revise onNext={() => {}} />);
    expect(screen.queryByText(/Blind round/)).toBeNull();
  });
});

describe('the context a first answer may carry', () => {
  it('no confidence chip is pre-selected, and a plain answer posts exactly {cardId, p}', async () => {
    const a = routes({ ...PROFILE, 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    for (const label of ['Hunch', 'Fairly sure', 'Very sure']) expect(chip('How sure are you?', label)).toHaveAttribute('aria-pressed', 'false');
    expect(chip('What is this based on?', 'Judgement only')).toHaveAttribute('aria-pressed', 'true');
    expect(coi()).not.toBeChecked();
    fireEvent.change(slider(), { target: { value: '40' } });
    await userEvent.click(lock());
    expect(await screen.findByText(/Saved: 40%/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.4 });
    const body = a.mock.calls.find((c) => c[1] === '/api/estimates')[2];
    expect(Object.keys(body)).toEqual(['cardId', 'p']);
  });

  it('choosing Very sure, a reason, Data or monitoring and the conflict box posts exactly those fields', async () => {
    const a = routes({ ...PROFILE, 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.click(chip('How sure are you?', 'Very sure'));
    await userEvent.type(reasonBox(), 'Monitoring data shows it.');
    await userEvent.click(chip('What is this based on?', 'Data or monitoring'));
    await userEvent.click(coi());
    fireEvent.change(slider(), { target: { value: '40' } });
    await userEvent.click(lock());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', {
      cardId: 'C1', p: 0.4, confidence: 3, reason: 'Monitoring data shows it.', evidenceType: 'data', coi: true,
    }));
  });

  it('a reason with leading and trailing spaces is sent trimmed', async () => {
    const a = routes({ ...PROFILE, 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.type(reasonBox(), '   Cases are rising.   ');
    fireEvent.change(slider(), { target: { value: '60' } });
    await userEvent.click(lock());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.6, reason: 'Cases are rising.' }));
  });

  it('the counter follows the reason, and the reason is capped at 600 characters', async () => {
    render(<CardView api={routes(PROFILE)} card={card()} mode="server" onNext={() => {}} />);
    expect(screen.getByText(/^0 of 600\./)).toBeInTheDocument();
    await userEvent.type(reasonBox(), 'abc');
    expect(screen.getByText(/^3 of 600\./)).toBeInTheDocument();
    await userEvent.clear(reasonBox());
    await userEvent.type(reasonBox(), 'a'.repeat(650));
    expect(reasonBox()).toHaveValue('a'.repeat(600));
    expect(screen.getByText(/^600 of 600\./)).toBeInTheDocument();
  });

  it('a reason naming a person or an organisation shows the identifying-detail warning, removing it clears the warning, and the warning never blocks the answer', async () => {
    const a = routes({ ...PROFILE, 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.type(reasonBox(), 'I work at the WFP office in Juba');
    expect(screen.getByText(/This could point to you or someone else/)).toHaveTextContent('“WFP”');
    fireEvent.change(slider(), { target: { value: '30' } });
    await userEvent.click(lock());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.3, reason: 'I work at the WFP office in Juba' }));
    expect(await screen.findByText(/Saved: 30%/)).toBeInTheDocument();
  });

  it('removing the identifying detail clears the warning', async () => {
    render(<CardView api={routes(PROFILE)} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.type(reasonBox(), 'I work at the WFP office in Juba');
    expect(screen.getByText(/This could point to you or someone else/)).toBeInTheDocument();
    await userEvent.clear(reasonBox());
    await userEvent.type(reasonBox(), 'Harvest reports are late this year.');
    expect(screen.queryByText(/This could point to you or someone else/)).toBeNull();
  });

  it('the identity block shows the level from the profile, in the words of LEVEL_COPY', async () => {
    render(<CardView api={routes(PROFILE)} card={card()} mode="server" onNext={() => {}} />);
    expect(await screen.findByText(`This will be shown as: ${LEVEL_COPY.pseudonymous.label}`)).toBeInTheDocument();
    expect(screen.getByText(LEVEL_COPY.pseudonymous.toPeers)).toBeInTheDocument();
  });

  it('the level is fetched once, however many times the card is shown', async () => {
    const a = routes(PROFILE);
    const { unmount } = render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await screen.findByText(/This will be shown as: Pseudonymous/);
    unmount();
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await screen.findByText(/This will be shown as: Pseudonymous/);
    expect(a.mock.calls.filter((c) => c[1] === '/api/me/profile')).toHaveLength(1);
  });

  it('a failing profile hides the identity block and the card still works', async () => {
    const a = routes({ 'GET /api/me/profile': fail(401, 'session invalid or expired'), 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await waitFor(() => expect(a.mock.calls.some((c) => c[1] === '/api/me/profile')).toBe(true));
    expect(screen.queryByText(/This will be shown as/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: /funding or position/ })).toBeInTheDocument();
    fireEvent.change(slider(), { target: { value: '45' } });
    await userEvent.click(lock());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.45 }));
  });

  it('a revision shows none of the context fields and posts exactly {cardId, p}', async () => {
    const a = routes({ ...PROFILE, 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 2, p: b.p }) });
    render(<CardView api={a} card={card(REVISION)} mode="server" revise onNext={() => {}} />);
    expect(screen.queryByRole('group', { name: 'How sure are you?' })).toBeNull();
    expect(screen.queryByLabelText(/^Why\?/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'What is this based on?' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/This will be shown as/)).toBeNull();
    fireEvent.change(slider(), { target: { value: '60' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save my revision' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.6 }));
    expect(Object.keys(a.mock.calls.find((c) => c[1] === '/api/estimates')[2])).toEqual(['cardId', 'p']);
  });

  it('answers queued offline keep their context with them', async () => {
    const a = routes({ ...PROFILE, 'POST /api/estimates': () => { throw new ApiError('You appear to be offline.', { offline: true }); } });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.click(chip('How sure are you?', 'Very sure'));
    await userEvent.type(reasonBox(), 'Harvest reports are late.');
    fireEvent.change(slider(), { target: { value: '33' } });
    await userEvent.click(lock());
    expect(await screen.findByText(/saved on this phone/)).toBeInTheDocument();
    expect(await pending()).toMatchObject([{ cardId: 'C1', p: 0.33, context: { confidence: 3, reason: 'Harvest reports are late.' } }]);
  });
});

describe('device-held key with context', () => {
  it('is Anonymous with no profile request, posts the ballot and the context, and sends no login header', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return json({ cardId: 'C1', round: 1, p: JSON.parse(init.body).p });
    }));
    render(<CardView api={a} card={card()} mode="device" onNext={() => {}} />);
    expect(await screen.findByText('This will be shown as: Anonymous')).toBeInTheDocument();
    await userEvent.click(chip('How sure are you?', 'Very sure'));
    await userEvent.type(reasonBox(), 'Field report.');
    await userEvent.click(chip('What is this based on?', 'I saw / heard it directly'));
    fireEvent.change(slider(), { target: { value: '30' } });
    await userEvent.click(lock());
    expect(await screen.findByText(/Saved: 30%/)).toBeInTheDocument();
    expect(a.mock.calls.map((c) => c[1])).not.toContain('/api/me/profile');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/api/anon/estimates');
    expect(seen[0].headers).toEqual({ 'content-type': 'application/json' });
    expect(Object.keys(seen[0].body).sort()).toEqual(['cardId', 'confidence', 'evidenceType', 'p', 'reason', 'signature', 'token']);
    expect(seen[0].body).toMatchObject({ cardId: 'C1', p: 0.3, confidence: 3, reason: 'Field report.', evidenceType: 'direct' });
    expect(srv.verify('C1', seen[0].body.token, seen[0].body.signature)).toBe(true);
  });
});
