import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pulse } from './Pulse.jsx';
import { App } from './App.jsx';
import { routes, fail, card, json, blindServer } from '../test-helpers.js';
import { createSecret, obtainBallot } from '../lib/device.js';
import { kvSet } from '../lib/kv.js';

const EMPTY = { week: { from: '2026-11-01', to: '2026-11-08' }, weeklyCap: 3, asks: [], radar: [], waiting: { revise: 0, discussion: 0, offers: 0 }, deviceMode: false };
const entry = (over = {}) => ({ card: card({ id: 'C1', window: { from: '2026-11-01', to: '2026-11-08' } }), why: [{ label: 'Covers Chad' }, { label: 'Theme match' }], reason: 'Covers Chad · Theme match', ...over });
const pulse = (over = {}) => ({ ...EMPTY, ...over });
const shown = (a) => routes({ 'GET /api/pulse': () => a });
const noop = () => {};
const props = (over = {}) => ({ mode: 'server', onExpired: noop, onOpenQuestions: noop, onOpenData: noop, onOpen: noop, ...over });

beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('Pulse', () => {
  it('shows the title, the greeting and the cap in plain words', async () => {
    render(<Pulse api={routes({ 'GET /api/pulse': pulse({ asks: [entry()] }), 'GET /api/me/profile': { level: 'anonymous' } })} {...props()} />);
    expect(await screen.findByRole('heading', { name: 'Your Pulse' })).toBeInTheDocument();
    expect(screen.getByText('Hello. We only ask when your declared expertise matches — 3/week at most. Nothing here is urgent unless it says so.')).toBeInTheDocument();
  });

  it('names an identified person in the greeting, and never a pseudonymous or anonymous one', async () => {
    const id = routes({ 'GET /api/pulse': pulse(), 'GET /api/me/profile': { level: 'identified', name: 'Amina Yusuf' } });
    const { unmount } = render(<Pulse api={id} {...props()} />);
    expect(await screen.findByText(/^Hello Amina Yusuf\. We only ask/)).toBeInTheDocument();
    unmount();
    render(<Pulse api={routes({ 'GET /api/pulse': pulse(), 'GET /api/me/profile': { level: 'pseudonymous', name: 'Amina Yusuf' } })} {...props()} />);
    expect(await screen.findByText(/^Hello\. We only ask/)).toBeInTheDocument();
    expect(screen.queryByText(/Amina/)).toBeNull();
  });

  it('each ask is a card: Asked of you, the country, when it closes, the question, why, and the answer button', async () => {
    render(<Pulse api={shown(pulse({ asks: [entry()] }))} {...props()} />);
    expect(await screen.findByText('Asked of you')).toBeInTheDocument();
    expect(screen.getByText('Chad')).toBeInTheDocument();
    expect(screen.getByText('closes 8 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.' })).toBeInTheDocument();
    expect(document.querySelector('.pulse-reasons')).toHaveTextContent("Why you're seeing this: Covers Chad · Theme match");
    expect(screen.getByRole('button', { name: 'Answer in ~90 seconds →' })).toBeInTheDocument();
  });

  it('shows no match score anywhere on the page', async () => {
    render(<Pulse api={shown(pulse({ asks: [entry()], radar: [entry({ card: card({ id: 'R1', statement: 'Floods in Sudan will displace 5 districts.' }), reason: 'Covers Chad (older than a week)' })] }))} {...props()} />);
    await screen.findByRole('heading', { name: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.' });
    expect(document.body.textContent).not.toMatch(/\bmatch\s*\d|\/100|score/i);
  });

  it('the answer button hands that ask to the page that opens the question', async () => {
    const open = vi.fn();
    const a = entry();
    render(<Pulse api={shown(pulse({ asks: [a] }))} {...props({ onOpen: open })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Answer in ~90 seconds →' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ card: expect.objectContaining({ id: 'C1' }) }));
  });

  it('with no asks it says the person is all caught up, and the answer slider is not on the list', async () => {
    render(<Pulse api={shown(pulse())} {...props()} />);
    expect(await screen.findByText("You're all caught up ✓")).toBeInTheDocument();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('the radar is listed, not pushed: each item opens its question, and an empty radar says nothing waiting', async () => {
    const open = vi.fn();
    const r = entry({ card: card({ id: 'R1', statement: 'Floods in Sudan will displace 5 districts.' }), reason: 'Covers Chad (older than a week)', why: [{ label: 'Covers Chad' }] });
    render(<Pulse api={shown(pulse({ radar: [r] }))} {...props({ onOpen: open })} />);
    expect(await screen.findByRole('heading', { name: 'On your radar — not pushed' })).toBeInTheDocument();
    expect(screen.getByText('In your domain, but we held them back (weekly cap or already enough views). Pull if you feel like it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Floods in Sudan will displace 5 districts\./ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ card: expect.objectContaining({ id: 'R1' }) }));
  });

  it('says nothing is waiting on the radar when it is empty', async () => {
    render(<Pulse api={shown(pulse())} {...props()} />);
    expect(await screen.findByText('Nothing waiting.')).toBeInTheDocument();
  });

  it('the transparency note is there, collapsed, and says why a question is held back', async () => {
    render(<Pulse api={shown(pulse())} {...props()} />);
    await screen.findByText('Nothing waiting.');
    expect(screen.getByText('Transparency: why these are not pushed').closest('details')).not.toHaveAttribute('open');
  });

  it('says the cap in the singular when it is one', async () => {
    render(<Pulse api={shown(pulse({ weeklyCap: 1 }))} {...props()} />);
    expect(await screen.findByText(/— 1\/week at most\./)).toBeInTheDocument();
  });

  it('hides the waiting strip when nothing is waiting', async () => {
    render(<Pulse api={shown(pulse())} {...props()} />);
    await screen.findByText("You're all caught up ✓");
    expect(screen.queryByText(/Also waiting for you/)).toBeNull();
  });

  it('the waiting strip counts in words and opens Questions', async () => {
    const open = vi.fn();
    render(<Pulse api={shown(pulse({ waiting: { revise: 2, discussion: 1, offers: 3 } }))} {...props({ onOpenQuestions: open })} />);
    expect(await screen.findByText('Also waiting for you: two questions to revise, one discussion and three publication offers.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to Questions' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a single waiting item reads on its own', async () => {
    render(<Pulse api={shown(pulse({ waiting: { revise: 0, discussion: 0, offers: 1 } }))} {...props()} />);
    expect(await screen.findByText('Also waiting for you: one publication offer.')).toBeInTheDocument();
  });

  it('reports the number of asks upward, so the nav can show it', async () => {
    const count = vi.fn();
    render(<Pulse api={shown(pulse({ asks: [entry(), entry({ card: card({ id: 'C2' }) })] }))} {...props({ onCount: count })} />);
    await screen.findAllByText('Asked of you');
    expect(count).toHaveBeenLastCalledWith(2);
  });

  it('a 401 sends the person back through onExpired', async () => {
    const expired = vi.fn();
    render(<Pulse api={routes({ 'GET /api/pulse': fail(401, 'session invalid or expired') })} {...props({ onExpired: expired })} />);
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('any other error is shown as an alert, not as a blank screen', async () => {
    const expired = vi.fn();
    render(<Pulse api={routes({ 'GET /api/pulse': fail(500, 'the radar is unavailable') })} {...props({ onExpired: expired })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('the radar is unavailable');
    expect(expired).not.toHaveBeenCalled();
  });

  it('an offline failure says so', async () => {
    const { ApiError } = await import('../lib/api.js');
    render(<Pulse api={routes({ 'GET /api/pulse': () => { throw new ApiError('You appear to be offline.', { offline: true }); } })} {...props()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/You are offline/);
  });

  it('a device-held ask this device has already answered is hidden, and one it has not is kept', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({
      'GET /api/blind/key': srv.key,
      'POST /api/blind/issue': (b) => srv.issue(b),
      'GET /api/pulse': pulse({
        deviceMode: true,
        asks: [entry({ card: card({ id: 'C1', statement: 'Answered on this phone already.' }), deviceHeld: true }),
          entry({ card: card({ id: 'C2', statement: 'Not answered on this phone yet.' }), deviceHeld: true })],
      }),
    });
    await obtainBallot(a, 'C1');
    const asked = [];
    const headers = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      asked.push(url); headers.push(init.headers);
      const body = JSON.parse(init.body);
      return json(body.cardId === 'C1' ? { round1: 0.4, round2: null } : { round1: null, round2: null });
    }));
    try {
      render(<Pulse api={a} {...props({ mode: 'device' })} />);
      expect(await screen.findByText('Not answered on this phone yet.')).toBeInTheDocument();
      expect(screen.queryByText('Answered on this phone already.')).toBeNull();
      expect(asked).toEqual(['/api/anon/status']);
      expect(Object.keys(headers[0]).map((h) => h.toLowerCase())).not.toContain('authorization');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a device-held card with no cached ballot is not asked about, so it stays visible', async () => {
    const a = routes({ 'GET /api/pulse': pulse({ deviceMode: true, asks: [entry({ deviceHeld: true })] }) });
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    try {
      render(<Pulse api={a} {...props({ mode: 'device' })} />);
      expect(await screen.findByText('Cholera cases in Chad will exceed 10,000 by 30 April 2027.')).toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the side cards', () => {
  const withSides = (over = {}) => pulse({
    circle: { country: 'TCD', members: 6, openCards: 2, withView: 2 },
    record: { answered: 16, revised: 3, objections: 1 },
    ...over,
  });

  it('the circle shows its member count, the country by name, and the view sentence', async () => {
    render(<Pulse api={shown(withSides())} {...props()} />);
    expect(await screen.findByText('Your circle · Chad')).toBeInTheDocument();
    expect(screen.getByText('members').parentElement).toHaveTextContent(/^6 members$/);
    expect(screen.getByText('2 of 2 open Chad risks have a circle view. Coverage is a shared goal — there is no public leaderboard.')).toBeInTheDocument();
  });

  it('a circle that is not yet five people is "forming", and shows no view counts', async () => {
    render(<Pulse api={shown(withSides({ circle: { country: 'TCD', members: null, openCards: 2, withView: 1 } }))} {...props()} />);
    expect(await screen.findByText('forming')).toBeInTheDocument();
    expect(screen.getByText('Your circle is still forming.')).toBeInTheDocument();
    expect(screen.queryByText(/have a circle view/)).toBeNull();
    expect(screen.queryByText(/members/)).toBeNull();
  });

  it('the standing shows the person’s own record counts, and the link to My data', async () => {
    const open = vi.fn();
    render(<Pulse api={shown(withSides())} {...props({ onOpenData: open })} />);
    expect(await screen.findByText('16 answered · 3 revised · 1 objections')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
    expect(screen.getByText('Your first resolved question unlocks your calibration mirror.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open my space' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a device-held person is told their answers cannot be counted here', async () => {
    render(<Pulse api={shown(withSides({ record: null }))} {...props()} />);
    expect(await screen.findByText('Your answers are held under a key only your phone has, so we cannot count them here.')).toBeInTheDocument();
    expect(screen.queryByText(/answered ·/)).toBeNull();
  });

  it('the craft badges card is the empty state, since no badges are computed yet', async () => {
    render(<Pulse api={shown(withSides())} {...props()} />);
    const heading = await screen.findByText('Craft badges');
    expect(within(heading.parentElement).getByText('Earned for quality, never volume.')).toBeInTheDocument();
  });

  it('a response without circle or record still renders, with no numbers', async () => {
    render(<Pulse api={shown(pulse({ asks: [entry()] }))} {...props()} />);
    expect(await screen.findByText('Your circle')).toBeInTheDocument();
    expect(screen.getByText('Circle numbers are not available right now.')).toBeInTheDocument();
    expect(screen.getByText('Your standing (private)')).toBeInTheDocument();
    expect(screen.queryByText(/members/)).toBeNull();
  });
});

describe('the whole app: Pulse, the question page and Back', () => {
  const SESSION = { 'GET /api/me/profile': { needsSetup: false, level: 'pseudonymous' } };
  const RESOLUTION = { objective: 'The WHO count exceeds 10,000 cases.', source: 'WHO situation reports', resolver: 'the ACAPS panel lead' };

  beforeEach(async () => { await kvSet('session.expert', 'tok'); await kvSet('session.mode', 'server'); });

  it('the Pulse button shows the number of asks, and no badge at zero', async () => {
    const { container, unmount } = render(<App api={routes({ ...SESSION, 'GET /api/pulse': pulse({ asks: [entry(), entry({ card: card({ id: 'C2' }) })] }) })} />);
    await screen.findAllByText('Asked of you');
    expect(screen.getByRole('button', { name: 'Pulse 2' })).toBeInTheDocument();
    expect(container.querySelector('.pulse-badge')).toHaveTextContent('2');
    unmount();
    const zero = render(<App api={routes({ ...SESSION, 'GET /api/pulse': pulse() })} />);
    await screen.findByText("You're all caught up ✓");
    expect(zero.container.querySelector('.pulse-badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pulse' })).toBeInTheDocument();
  });

  it('Answer opens the question page with its breadcrumb and the answer card, and the address records it', async () => {
    const a = routes({ ...SESSION, 'GET /api/pulse': pulse({ asks: [entry({ card: card({ id: 'C1', resolution: RESOLUTION }) })] }) });
    const { container } = render(<App api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Answer in ~90 seconds →' }));
    expect(await screen.findByRole('button', { name: '← Pulse' })).toBeInTheDocument();
    expect(container.querySelector('.question-crumbs .pill.indigo')).toHaveTextContent('Risk question');
    expect(screen.getByText('closes 30 Apr 2027')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /probability/i })).toBeInTheDocument();
    expect(window.history.state).toEqual({ view: 'question' });
  });

  it('the ← Pulse breadcrumb returns to the Pulse screen', async () => {
    render(<App api={routes({ ...SESSION, 'GET /api/pulse': pulse({ asks: [entry()] }) })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Answer in ~90 seconds →' }));
    await userEvent.click(await screen.findByRole('button', { name: '← Pulse' }));
    expect(await screen.findByRole('heading', { name: 'Your Pulse' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('the browser Back button returns from the question page to Pulse', async () => {
    render(<App api={routes({ ...SESSION, 'GET /api/pulse': pulse({ asks: [entry()] }) })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Answer in ~90 seconds →' }));
    expect(await screen.findByRole('slider', { name: /probability/i })).toBeInTheDocument();
    window.history.back();
    expect(await screen.findByRole('heading', { name: 'Your Pulse' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('answering from the question page posts the estimate, and Next question goes back to Pulse', async () => {
    let served = [entry()];
    const a = routes({
      ...SESSION,
      'GET /api/pulse': () => pulse({ asks: served }),
      'POST /api/estimates': (b) => { served = []; return { cardId: b.cardId, round: 1, p: b.p, clamped: false }; },
    });
    render(<App api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Answer in ~90 seconds →' }));
    fireEvent.change(await screen.findByRole('slider', { name: /probability/i }), { target: { value: '51' } });
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    expect(await screen.findByText(/Saved: 51%/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.51 });
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(await screen.findByRole('heading', { name: 'Your Pulse' })).toBeInTheDocument();
    expect(await screen.findByText("You're all caught up ✓")).toBeInTheDocument();
  });

  it('a 401 on Pulse sends the person back to the sign-in screen', async () => {
    render(<App api={routes({ ...SESSION, 'GET /api/pulse': fail(401, 'session invalid or expired') })} />);
    expect(await screen.findByText(/invitation-only panel/)).toBeInTheDocument();
  });
});
