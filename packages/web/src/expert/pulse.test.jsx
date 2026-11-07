import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pulse } from './Pulse.jsx';
import { routes, fail, card, json, blindServer } from '../test-helpers.js';
import { createSecret, obtainBallot } from '../lib/device.js';

const EMPTY = { week: { from: '2026-11-01', to: '2026-11-08' }, weeklyCap: 3, asks: [], radar: [], waiting: { revise: 0, discussion: 0, offers: 0 }, deviceMode: false };
const entry = (over = {}) => ({ card: card({ id: 'C1' }), why: [{ label: 'Covers Chad' }, { label: 'Theme match' }], reason: 'Covers Chad; Theme match', ...over });
const pulse = (over = {}) => ({ ...EMPTY, ...over });
const shown = (a) => routes({ 'GET /api/pulse': () => a });

describe('Pulse', () => {
  it('shows the title, the cap in plain words, and each ask with its reasons as labels', async () => {
    render(<Pulse api={shown(pulse({ asks: [entry()] }))} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Your Pulse' })).toBeInTheDocument();
    expect(screen.getByText('At most 3 new questions a week (you set that in My data). Nothing is urgent unless it says so.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asked of you this week' })).toBeInTheDocument();
    expect(screen.getByText('Covers Chad')).toBeInTheDocument();
    expect(screen.getByText('Theme match')).toBeInTheDocument();
    expect(screen.getByText('Cholera cases in Chad will exceed 10,000 by 30 April 2027.')).toBeInTheDocument();
    // The answer UI is the existing CardView, in place.
    expect(screen.getByRole('slider', { name: /probability/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ACAPS|score|minMatch/i);
  });

  it('says why only once for an ask, and gives a radar entry its own explanation', async () => {
    const ask = entry({ reason: 'Covers Chad · Theme match' });
    const old = entry({ card: card({ id: 'R1', statement: 'Floods in Sudan will displace 5 districts.' }), reason: 'Covers Chad · Theme match (older than a week)' });
    render(<Pulse api={shown(pulse({ asks: [ask], radar: [old] }))} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    await screen.findByRole('heading', { name: 'Asked of you this week' });
    expect(screen.queryByText('Covers Chad · Theme match')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 question' }));
    expect(await screen.findByText('older than a week')).toBeInTheDocument();
  });

  it('shows the plain empty state when nothing matches', async () => {
    render(<Pulse api={shown(pulse())} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByText('Nothing new matches what you cover this week.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'On your radar, not pushed' })).toBeNull();
  });

  it('keeps the radar collapsed until it is opened, and says the questions are not pushed', async () => {
    render(<Pulse api={shown(pulse({ radar: [entry({ card: card({ id: 'R1', statement: 'Floods in Sudan will displace 5 districts.' }) }), entry({ card: card({ id: 'R2', statement: 'Rail strikes in Kenya will continue.' }) })] }))} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'On your radar, not pushed' })).toBeInTheDocument();
    expect(screen.getByText('You can answer these any time; they are just not pushed.')).toBeInTheDocument();
    expect(screen.queryByText('Floods in Sudan will displace 5 districts.')).toBeNull();
    const show = screen.getByRole('button', { name: 'Show 2 questions' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(show);
    expect(await screen.findByText('Floods in Sudan will displace 5 districts.')).toBeInTheDocument();
    expect(screen.getByText('Rail strikes in Kenya will continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide 2 questions' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says the cap in the singular when it is one', async () => {
    render(<Pulse api={shown(pulse({ weeklyCap: 1 }))} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByText(/At most 1 new question a week/)).toBeInTheDocument();
  });

  it('hides the waiting strip when nothing is waiting', async () => {
    render(<Pulse api={shown(pulse())} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    await screen.findByText('Nothing new matches what you cover this week.');
    expect(screen.queryByText(/Also waiting for you/)).toBeNull();
    expect(screen.queryByText(/outside/)).toBeNull();
  });

  it('the waiting strip counts in words and opens Questions', async () => {
    const open = vi.fn();
    render(<Pulse api={shown(pulse({ waiting: { revise: 2, discussion: 1, offers: 3 } }))} mode="server" onExpired={() => {}} onOpenQuestions={open} />);
    expect(await screen.findByText('Also waiting for you: two questions to revise, one discussion and three publication offers.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to Questions' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a single waiting item reads on its own', async () => {
    render(<Pulse api={shown(pulse({ waiting: { revise: 0, discussion: 0, offers: 1 } }))} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByText('Also waiting for you: one publication offer.')).toBeInTheDocument();
  });

  it('answering an ask in place posts the estimate, then reloads the pulse without it', async () => {
    let served = [entry()];
    const a = routes({
      'GET /api/pulse': () => pulse({ asks: served }),
      'POST /api/estimates': (b) => { served = []; return { cardId: b.cardId, round: 1, p: b.p, clamped: false }; },
    });
    render(<Pulse api={a} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
    fireEvent.change(await screen.findByRole('slider', { name: /probability/i }), { target: { value: '40' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Saved: 40%/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.4 });
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await waitFor(() => expect(screen.getByText('Nothing new matches what you cover this week.')).toBeInTheDocument());
    expect(a.mock.calls.filter((c) => c[1] === '/api/pulse')).toHaveLength(2);
  });

  it('a 401 sends the person back through onExpired', async () => {
    const expired = vi.fn();
    render(<Pulse api={routes({ 'GET /api/pulse': fail(401, 'session invalid or expired') })} mode="server" onExpired={expired} onOpenQuestions={() => {}} />);
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('any other error is shown as an alert, not as a blank screen', async () => {
    const expired = vi.fn();
    render(<Pulse api={routes({ 'GET /api/pulse': fail(500, 'the radar is unavailable') })} mode="server" onExpired={expired} onOpenQuestions={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('the radar is unavailable');
    expect(expired).not.toHaveBeenCalled();
  });

  it('an offline failure says so', async () => {
    const { ApiError } = await import('../lib/api.js');
    render(<Pulse api={routes({ 'GET /api/pulse': () => { throw new ApiError('You appear to be offline.', { offline: true }); } })} mode="server" onExpired={() => {}} onOpenQuestions={() => {}} />);
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
    render(<Pulse api={a} mode="device" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByText('Not answered on this phone yet.')).toBeInTheDocument();
    expect(screen.queryByText('Answered on this phone already.')).toBeNull();
    expect(asked).toEqual(['/api/anon/status']);
    expect(Object.keys(headers[0]).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('a device-held card with no cached ballot is not asked about, so it stays visible', async () => {
    const a = routes({ 'GET /api/pulse': pulse({ deviceMode: true, asks: [entry({ deviceHeld: true })] }) });
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    render(<Pulse api={a} mode="device" onExpired={() => {}} onOpenQuestions={() => {}} />);
    expect(await screen.findByText('Cholera cases in Chad will exceed 10,000 by 30 April 2027.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
