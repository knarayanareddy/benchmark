import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.jsx';
import { Onboard } from './Onboard.jsx';
import { CardView } from './CardView.jsx';
import { Inbox } from './Inbox.jsx';
import { MyData } from './MyData.jsx';
import { routes, fail, blindServer, card, emptyInbox, json } from '../test-helpers.js';
import { kvGet, kvSet } from '../lib/kv.js';
import { getSecret, hasDeviceSecret, createSecret, obtainBallot, cachedBallot } from '../lib/device.js';
import { decodeRecovery } from '../lib/recovery.js';
import { pending } from '../lib/queue.js';

const CONSENT = { version: '2026-11-v2', level: 'x', text: 'Consent 2026-11-v2\nResidual risk: something' };

beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('onboarding', () => {
  const api = () => routes({
    'GET /api/consent/pseudonymous': { ...CONSENT, text: 'PSEUDO TEXT' },
    'GET /api/consent/anonymous': { ...CONSENT, text: 'ANON TEXT' },
    'POST /api/invite/redeem': () => ({ sessionToken: 'tok', mode: 'server', level: 'pseudonymous' }),
  });

  it('shows the exact consent text, and will not continue until it is accepted', async () => {
    const a = api(); const done = vi.fn();
    render(<Onboard api={a} invite="inv" deviceKeys onDone={done} />);
    const go = screen.getByRole('button', { name: 'Accept and continue' });
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Pseudonymous/));
    expect(await screen.findByText('PSEUDO TEXT')).toBeInTheDocument();
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have read this/));
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
    expect(a).toHaveBeenCalledWith('POST', '/api/invite/redeem', { token: 'inv', level: 'pseudonymous', consentVersion: '2026-11-v2', mode: undefined });
  });

  it('offers the device-held key only to anonymous experts, and only if the service has it', async () => {
    const { rerender } = render(<Onboard api={api()} invite="i" deviceKeys onDone={() => {}} />);
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
    await userEvent.click(screen.getByLabelText(/^Anonymous/));
    expect(await screen.findByLabelText(/Keep my key on this device only/)).toBeInTheDocument();
    rerender(<Onboard api={api()} invite="i" deviceKeys={false} onDone={() => {}} />);
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
  });

  it('a device-held key creates a secret, shows its recovery code, and needs it saved before continuing', async () => {
    const a = routes({
      'GET /api/consent/anonymous': { ...CONSENT, text: 'ANON TEXT' },
      'GET /api/consent/anonymous?mode=device': { ...CONSENT, text: 'DEVICE TEXT' },
      'POST /api/invite/redeem': () => ({ sessionToken: 'tok', mode: 'device', level: 'anonymous' }),
    });
    const done = vi.fn();
    render(<Onboard api={a} invite="inv" deviceKeys onDone={done} />);
    await userEvent.click(screen.getByLabelText(/^Anonymous/));
    await userEvent.click(await screen.findByLabelText(/Keep my key on this device only/));
    expect(await screen.findByText('DEVICE TEXT')).toBeInTheDocument();
    const code = (await screen.findByTestId('recovery')).textContent;
    expect(code).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{2}$/);
    expect(Buffer.from(decodeRecovery(code))).toEqual(Buffer.from(await getSecret()));
    const go = screen.getByRole('button', { name: 'Accept and continue' });
    await userEvent.click(screen.getByLabelText(/I have read this/));
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have saved my recovery code/));
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(a).toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.objectContaining({ mode: 'device' }));
    expect(JSON.stringify(a.mock.calls)).not.toContain(code);
  });

  it('switching the device key off removes the secret it had made', async () => {
    const a = routes({ 'GET /api/consent/anonymous': CONSENT, 'GET /api/consent/anonymous?mode=device': CONSENT });
    render(<Onboard api={a} invite="inv" deviceKeys onDone={() => {}} />);
    await userEvent.click(screen.getByLabelText(/^Anonymous/));
    const box = await screen.findByLabelText(/Keep my key on this device only/);
    await userEvent.click(box);
    await screen.findByTestId('recovery');
    expect(await hasDeviceSecret()).toBe(true);
    await userEvent.click(box);
    await waitFor(() => expect(screen.queryByTestId('recovery')).toBeNull());
  });

  it('shows the service refusing the invite', async () => {
    const a = routes({ 'GET /api/consent/identified': CONSENT, 'POST /api/invite/redeem': fail(401, 'invite already used') });
    render(<Onboard api={a} invite="inv" deviceKeys onDone={() => {}} />);
    await userEvent.click(screen.getByLabelText(/Known/));
    await userEvent.click(await screen.findByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invite already used');
  });
});

describe('answering', () => {
  const slider = () => screen.getByRole('slider', { name: /probability/i });

  it('starts at ACAPS’ own reading, and sends what the expert moved it to', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p, clamped: false }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    expect(slider()).toHaveValue('71');
    fireEvent.change(slider(), { target: { value: '40' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Saved: 40%/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.4 });
    expect(slider()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Something is wrong/ })).toBeInTheDocument();
  });

  it('keeps the answer on the phone when offline, and says so', async () => {
    const { ApiError } = await import('../lib/api.js');
    const a = routes({ 'POST /api/estimates': () => { throw new ApiError('You appear to be offline.', { offline: true }); } });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    fireEvent.change(slider(), { target: { value: '33' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/saved on this phone/)).toBeInTheDocument();
    expect(await pending()).toMatchObject([{ cardId: 'C1', p: 0.33 }]);
  });

  it('shows a refusal instead of pretending it was saved', async () => {
    const a = routes({ 'POST /api/estimates': fail(409, 'you have already answered this round') });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already answered');
    expect(await pending()).toEqual([]);
  });

  it('a revision shows the panel result and the first answer', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 2, p: b.p }) });
    const c = card({ round: 2, yourEstimate: 0.2, release: { suppressed: false, n: 6, estimate: 0.55, lo: 0.4, hi: 0.7 } });
    render(<CardView api={a} card={c} mode="server" revise onNext={() => {}} />);
    expect(screen.getByText(/Panel \(6 experts\): 55%, range 40%–70%/)).toBeInTheDocument();
    expect(screen.getByText(/Your first answer was 20%/)).toBeInTheDocument();
    expect(slider()).toHaveValue('20');
    await userEvent.click(screen.getByRole('button', { name: 'Save my revision' }));
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('an objection with identifying detail is sent, and the warning is shown', async () => {
    const a = routes({ 'POST /api/dissents': () => ({ id: 'd1', version: 0, warnings: ['the contribution names an organisation ("WFP")'] }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Something is wrong/ }));
    await userEvent.type(screen.getByLabelText('Details'), 'I work for WFP and the window is wrong.');
    await userEvent.click(screen.getByRole('button', { name: 'Send objection' }));
    expect(await screen.findByText(/Before it is read: the contribution names an organisation/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/dissents', { cardId: 'C1', kind: 'two_risks', text: 'I work for WFP and the window is wrong.' });
  });
});

describe('device-held key', () => {
  it('answers with a blind-signed ballot and NO login header', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return json({ cardId: 'C1', round: 1, p: JSON.parse(init.body).p });
    }));
    render(<CardView api={a} card={card({ deviceHeld: true })} mode="device" onNext={() => {}} />);
    fireEvent.change(screen.getByRole('slider', { name: /probability/i }), { target: { value: '25' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Saved: 25%/)).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/api/anon/estimates');
    expect(Object.keys(seen[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(srv.verify('C1', seen[0].body.token, seen[0].body.signature)).toBe(true);
    expect(a.mock.calls.map((c) => c[1])).toEqual(['/api/blind/key', '/api/blind/issue']);
    expect(JSON.stringify(a.mock.calls)).not.toContain(seen[0].body.token);
  });

  it('a revision asks the device what it answered, and refuses to revise a round it skipped', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    vi.stubGlobal('fetch', vi.fn(async () => json({ round1: null, round2: null })));
    render(<CardView api={a} card={card({ round: 2, deviceHeld: true, release: null })} mode="device" revise onNext={() => {}} />);
    expect(await screen.findByText(/did not answer the first round/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save my revision' })).toBeNull();
  });

  it('the inbox hides cards this device has already answered', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b), 'GET /api/inbox': emptyInbox({ deviceMode: true, toAnswer: [card({ id: 'C1' }), card({ id: 'C2', statement: 'Second question about floods.' })] }) });
    await obtainBallot(a, 'C1');
    vi.stubGlobal('fetch', vi.fn(async () => json({ round1: 0.4, round2: null })));
    render(<Inbox api={a} mode="device" onExpired={() => {}} />);
    expect(await screen.findByText('Second question about floods.')).toBeInTheDocument();
    expect(screen.queryByText(/Cholera cases in Chad/)).toBeNull();
  });

  it('"my data" erases with the device key first, then the account, then forgets the key', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b), 'DELETE /api/me': { erased: true } });
    await obtainBallot(a, 'C1'); await obtainBallot(a, 'C2');
    const order = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { order.push(url); return json({ removed: 1 }); }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const erased = vi.fn();
    render(<MyData api={a} mode="device" onErased={erased} />);
    await userEvent.click(screen.getByRole('button', { name: /Erase my data/ }));
    expect(await screen.findByText(/2 answers erased/)).toBeInTheDocument();
    expect(order).toEqual(['/api/anon/erase', '/api/anon/erase']);
    expect(a).toHaveBeenCalledWith('DELETE', '/api/me');
    expect(await hasDeviceSecret()).toBe(false);
    expect(await cachedBallot('C1')).toBeNull();
    expect(erased).toHaveBeenCalled();
  });

  it('erase does nothing if the person says no', async () => {
    const a = routes({});
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MyData api={a} mode="server" onErased={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Erase my data/ }));
    expect(a).not.toHaveBeenCalled();
  });
});

describe('inbox and the whole app', () => {
  it('shows a safety-override notice and lets the expert dismiss it', async () => {
    let notices = [{ id: 'n1', kind: 'break_glass', day: '2026-11-07', text: 'On 2026-11-07, two ACAPS moderators opened the sealed note on an anonymous objection you sent, because of a welfare concern.' }];
    const a = routes({ 'GET /api/inbox': () => emptyInbox({ notices }), 'DELETE /api/me/notices/n1': () => { notices = []; return { ok: true }; } });
    render(<Inbox api={a} mode="server" onExpired={() => {}} />);
    expect(await screen.findByText(/two ACAPS moderators opened the sealed note/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I have read this' }));
    await waitFor(() => expect(screen.queryByText(/two ACAPS moderators/)).toBeNull());
  });

  it('an expired session sends the person back, with a way to restore a device key', async () => {
    await kvSet('session.expert', 'old');
    const a = routes({ 'GET /api/inbox': fail(401, 'session invalid or expired') });
    render(<App api={a} />);
    expect(await screen.findByText(/invitation-only panel/)).toBeInTheDocument();
    expect(await kvGet('session.expert')).toBeUndefined();
  });

  it('a recovery code restores the key on a new phone, and a wrong one is caught', async () => {
    render(<App api={routes({})} />);
    await userEvent.click(await screen.findByText(/I chose a device-held key/));
    await userEvent.type(screen.getByLabelText('Recovery code'), 'AAAA-BBBB');
    await userEvent.click(screen.getByRole('button', { name: 'Restore my key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/54 characters/);
    const { encodeRecovery } = await import('../lib/recovery.js');
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    await userEvent.clear(screen.getByLabelText('Recovery code'));
    await userEvent.type(screen.getByLabelText('Recovery code'), encodeRecovery(secret));
    await userEvent.click(screen.getByRole('button', { name: 'Restore my key' }));
    expect(await screen.findByText(/Key restored/)).toBeInTheDocument();
    expect(Buffer.from(await getSecret())).toEqual(Buffer.from(secret));
  });

  it('an invite link in the address starts onboarding, signs in, and clears the link from the address bar', async () => {
    window.history.replaceState(null, '', '/#invite=abc');
    const a = routes({
      'GET /api/consent/identified': CONSENT,
      'POST /api/invite/redeem': () => ({ sessionToken: 'newtok', mode: 'server', level: 'identified' }),
      'GET /api/inbox': emptyInbox({ toAnswer: [card()] }),
    });
    render(<App api={a} />);
    await userEvent.click(await screen.findByLabelText(/Known/));
    await userEvent.click(await screen.findByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(await screen.findByText(/Cholera cases in Chad/)).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(await kvGet('session.expert')).toBe('newtok');
  });

  it('answers queued offline are sent when the connection returns', async () => {
    await kvSet('session.expert', 'tok'); await kvSet('session.mode', 'server');
    const { enqueue } = await import('../lib/queue.js');
    await enqueue('C1', 0.3);
    const a = routes({ 'GET /api/inbox': emptyInbox(), 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<App api={a} />);
    expect(await screen.findByText(/1 answer waiting to send/)).toBeInTheDocument();
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.3 }));
    await waitFor(() => expect(screen.queryByText(/waiting to send/)).toBeNull());
    expect(await pending()).toEqual([]);
  });

  it('says so when offline', async () => {
    await kvSet('session.expert', 'tok');
    const a = routes({ 'GET /api/inbox': emptyInbox() });
    render(<App api={a} />);
    await screen.findByText(/New questions/);
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText(/You are offline. You can still answer/)).toBeInTheDocument();
  });
});
