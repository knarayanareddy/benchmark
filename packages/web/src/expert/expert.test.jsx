import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetConfigCache } from '../lib/config.js';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.jsx';
import { CardView } from './CardView.jsx';
import { Inbox } from './Inbox.jsx';
import { MyData } from './MyData.jsx';
import { routes, fail, blindServer, card, emptyInbox, json } from '../test-helpers.js';
import { kvGet, kvSet } from '../lib/kv.js';
import { getSecret, hasDeviceSecret, createSecret, obtainBallot, cachedBallot } from '../lib/device.js';
import { pending } from '../lib/queue.js';

/** What the Pulse screen needs to render, with nothing asked of the person. */
const EMPTY_PULSE = { week: { from: '2026-11-01', to: '2026-11-08' }, weeklyCap: 3, minMatch: 30, asks: [], radar: [], outside: 0, waiting: { revise: 0, discussion: 0, offers: 0 }, deviceMode: false };

beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('answering', () => {
  const slider = () => screen.getByRole('slider', { name: /probability/i });

  it('Round 1 is blind: nothing is filled in, Submit is off until the expert puts a number down, and no ACAPS text appears', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p, clamped: false }) });
    const { container } = render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    expect(screen.getByRole('button', { name: 'Lock in my estimate' })).toBeDisabled();
    expect(screen.getByLabelText('Or type it (1–99)')).toHaveValue(null);
    expect(container.querySelector('output')).toHaveTextContent('—');
    // The blind-round notice names ACAPS on purpose; what must never appear is any number or rating of theirs.
    expect(container.textContent.replace(/Blind round: ACAPS’s rating and the circle’s views are hidden until you answer\./, '')).not.toMatch(/ACAPS|71%|starts at/i);
    expect(container.textContent).toMatch(/Blind round/);
    fireEvent.change(slider(), { target: { value: '40' } });
    expect(screen.getByRole('button', { name: 'Lock in my estimate' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    expect(await screen.findByText(/Saved: 40%/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.4 });
    expect(slider()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Something is wrong/ })).toBeInTheDocument();
  });

  it('a number can be typed instead, only whole numbers 1 to 99 are accepted, and the value is never pre-set', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    const box = screen.getByLabelText('Or type it (1–99)');
    await userEvent.type(box, '150');
    expect(await screen.findByRole('alert')).toHaveTextContent('whole number from 1 to 99');
    expect(screen.getByRole('button', { name: 'Lock in my estimate' })).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, '7');
    expect(screen.getByRole('button', { name: 'Lock in my estimate' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.07 }));
  });

  it('tabbing into the slider does not record an answer, and an impossible typed number is not echoed back', async () => {
    const a = routes({});
    const { container } = render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    await userEvent.tab();
    await userEvent.tab();
    fireEvent.keyUp(slider(), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Lock in my estimate' })).toBeDisabled();
    expect(container.querySelector('output')).toHaveTextContent('—');
    await userEvent.type(screen.getByLabelText('Or type it (1–99)'), '150');
    expect(container.querySelector('output')).toHaveTextContent('—');
  });

  it('answering exactly where the thumb rests still counts once the expert releases it', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p }) });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    fireEvent.pointerUp(slider());
    expect(screen.getByRole('button', { name: 'Lock in my estimate' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.5 }));
  });

  it('keeps the answer on the phone when offline, and says so', async () => {
    const { ApiError } = await import('../lib/api.js');
    const a = routes({ 'POST /api/estimates': () => { throw new ApiError('You appear to be offline.', { offline: true }); } });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    fireEvent.change(slider(), { target: { value: '33' } });
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    expect(await screen.findByText(/saved on this phone/)).toBeInTheDocument();
    expect(await pending()).toMatchObject([{ cardId: 'C1', p: 0.33 }]);
  });

  it('shows a refusal instead of pretending it was saved', async () => {
    const a = routes({ 'POST /api/estimates': fail(409, 'you have already answered this round') });
    render(<CardView api={a} card={card()} mode="server" onNext={() => {}} />);
    fireEvent.change(slider(), { target: { value: '60' } });
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already answered');
    expect(await pending()).toEqual([]);
  });

  it('a revision shows the picture with the circle result and the first answer', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 2, p: b.p }) });
    const c = card({ round: 2, yourEstimate: 0.2, release: { suppressed: false, n: 6, estimate: 0.55, lo: 0.4, hi: 0.7 } });
    render(<CardView api={a} card={c} mode="server" revise onNext={() => {}} />);
    expect(screen.getByRole('img', { name: /Circle pooled estimate 55 percent/ })).toBeInTheDocument();
    expect(screen.getByText(/Your locked first estimate/)).toHaveTextContent('Your locked first estimate: 20%');
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
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
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

describe('second look (round 2)', () => {
  const SL = { available: true };
  const rev = (over = {}) => card({ round: 2, yourEstimate: 0.2, release: null, secondLook: SL, ...over });
  const balanced = { kind: 'balanced', higher: ['Recent cases rose.', 'Rainy season starts.'], lower: ['Vaccines arrived.'] };
  const analysis = { kind: 'acaps_view', acapsReasoning: 'Line one.\nLine two.', sources: [{ label: 'WHO bulletin', url: 'https://who.int/x' }, { label: 'Local report', url: 'http://insecure.example/y' }] };
  const offer = () => screen.getByRole('button', { name: 'Look at the background first (optional)' });
  const keep = () => screen.getByRole('button', { name: 'Keep my first answer' });
  const save = () => screen.getByRole('button', { name: 'Save my revision' });
  const slider = () => screen.getByRole('slider', { name: /probability/i });

  it('offers the optional background only in round 2, and only when the service says it is available', () => {
    const { rerender } = render(<CardView api={routes({})} card={rev()} mode="server" revise onNext={() => {}} />);
    expect(offer()).toBeInTheDocument();
    rerender(<CardView api={routes({})} card={rev({ secondLook: { available: false } })} mode="server" revise onNext={() => {}} />);
    expect(screen.queryByRole('button', { name: /Look at the background/ })).toBeNull();
    rerender(<CardView api={routes({})} card={rev({ secondLook: undefined })} mode="server" revise onNext={() => {}} />);
    expect(screen.queryByRole('button', { name: /Look at the background/ })).toBeNull();
    rerender(<CardView api={routes({})} card={card({ secondLook: SL })} mode="server" onNext={() => {}} />);
    expect(screen.queryByRole('button', { name: /Look at the background/ })).toBeNull();
  });

  it('a logged-in expert fetches by the login, and sees balanced reasons under the same headings and markup', async () => {
    const a = routes({ 'POST /api/second-look': (b) => { expect(b).toEqual({ cardId: 'C1' }); return balanced; } });
    render(<CardView api={a} card={rev()} mode="server" revise onNext={() => {}} />);
    expect(screen.getByText(/Your locked first estimate/)).toHaveTextContent('Your locked first estimate: 20%');
    await userEvent.click(offer());
    const higher = await screen.findByRole('heading', { name: 'Reasons it could be more likely' });
    const lower = screen.getByRole('heading', { name: 'Reasons it could be less likely' });
    expect(screen.getByRole('heading', { name: 'Background' })).toBeInTheDocument();
    // Same wrapper, same child tags and classes on both sides.
    const shape = (el) => [el.parentElement.tagName, el.parentElement.className, [...el.parentElement.children].map((c) => c.tagName)];
    expect(shape(higher)).toEqual(shape(lower));
    expect(within(higher.parentElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Recent cases rose.', 'Rainy season starts.']);
    expect(within(lower.parentElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Vaccines arrived.']);
    expect(screen.getByText(/Shown to help you check your thinking. You do not have to change your answer./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Look at the background/ })).toBeNull();
  });

  it('a device-held expert proves the blind ballot first and sends it with no login header', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ url, headers: init.headers, body });
      if (url === '/api/anon/status') return json({ round1: 0.2, round2: null });
      if (url === '/api/anon/second-look') return json(balanced);
      throw new Error(`unexpected ${url}`);
    }));
    render(<CardView api={a} card={rev({ deviceHeld: true })} mode="device" revise onNext={() => {}} />);
    await waitFor(() => expect(keep()).toBeEnabled());
    await userEvent.click(offer());
    expect(await screen.findByRole('heading', { name: 'Reasons it could be more likely' })).toBeInTheDocument();
    const look = seen.filter((s) => s.url === '/api/anon/second-look');
    expect(look).toHaveLength(1);
    expect(look[0].headers).toEqual({ 'content-type': 'application/json' });
    expect(Object.keys(look[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(look[0].body).toMatchObject({ cardId: 'C1' });
    expect(srv.verify('C1', look[0].body.token, look[0].body.signature)).toBe(true);
    expect(look[0].body.token).toBe(seen.find((s) => s.url === '/api/anon/status').body.token);
  });

  it.each([['balanced', balanced], ['acaps_view', analysis]])('the %s background names no arm and no probability', async (_kind, look) => {
    const a = routes({ 'POST /api/second-look': () => look });
    const { container } = render(<CardView api={a} card={rev()} mode="server" revise onNext={() => {}} />);
    await userEvent.click(offer());
    const section = (await screen.findByRole('heading', { name: 'Background' })).closest('section');
    expect(section.textContent).not.toMatch(/control|acaps_view|balanced|probab|\d\s*%/i);
    expect(container.textContent).not.toMatch(/control|acaps_view|balanced/i);
  });

  it('an analysis shows its reasoning with line breaks kept, and links only https sources', async () => {
    const a = routes({ 'POST /api/second-look': () => analysis });
    render(<CardView api={a} card={rev()} mode="server" revise onNext={() => {}} />);
    await userEvent.click(offer());
    expect(await screen.findByRole('heading', { name: "ACAPS's analysis" })).toBeInTheDocument();
    expect(screen.getByText(/Line one\. Line two\./)).toHaveClass('pre-wrap');
    const link = screen.getByRole('link', { name: 'WHO bulletin' });
    expect(link).toHaveAttribute('href', 'https://who.int/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'Local report' })).toBeNull();
    expect(screen.getByText('Local report').closest('li').querySelector('a')).toBeNull();
    expect(screen.getByText('Local report').closest('li')).toHaveTextContent(/^Local report$/);
  });

  it('shows Loading… while the background is fetched', async () => {
    const a = routes({ 'POST /api/second-look': () => new Promise(() => {}) });
    render(<CardView api={a} card={rev()} mode="server" revise onNext={() => {}} />);
    await userEvent.click(offer());
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
  });

  it('a refused background says why, and the revision form stays usable', async () => {
    const a = routes({ 'POST /api/second-look': fail(409, 'there is no extra background for this question'), 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 2, p: b.p }) });
    render(<CardView api={a} card={rev()} mode="server" revise onNext={() => {}} />);
    await userEvent.click(offer());
    expect(await screen.findByRole('alert')).toHaveTextContent('there is no extra background for this question');
    expect(offer()).toBeInTheDocument();
    fireEvent.change(slider(), { target: { value: '45' } });
    await userEvent.click(save());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.45 }));
  });

  it('"Keep my first answer" submits exactly the first answer, and "Save my revision" submits the slider', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 2, p: b.p }) });
    const { unmount } = render(<CardView api={a} card={rev({ yourEstimate: 0.37 })} mode="server" revise onNext={() => {}} />);
    fireEvent.change(slider(), { target: { value: '80' } }); // the slider is elsewhere: Keep must still send 37%
    await userEvent.click(keep());
    expect(await screen.findByText(/Saved: 37%/)).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.37 });
    unmount();
    const b = routes({ 'POST /api/estimates': (x) => ({ cardId: x.cardId, round: 2, p: x.p }) });
    render(<CardView api={b} card={rev()} mode="server" revise onNext={() => {}} />);
    fireEvent.change(slider(), { target: { value: '60' } });
    await userEvent.click(save());
    expect(await screen.findByText(/Saved: 60%/)).toBeInTheDocument();
    expect(b).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.6 });
  });

  it('a device-held expert keeps the first answer through the device, and the answer is the one it recovered', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ url, body });
      if (url === '/api/anon/status') return json({ round1: 0.37, round2: null });
      return json({ cardId: 'C1', round: 2, p: body.p });
    }));
    render(<CardView api={a} card={rev({ yourEstimate: undefined, deviceHeld: true })} mode="device" revise onNext={() => {}} />);
    await waitFor(() => expect(keep()).toBeEnabled());
    fireEvent.change(slider(), { target: { value: '80' } });
    await userEvent.click(keep());
    expect(await screen.findByText(/Saved: 37%/)).toBeInTheDocument();
    const sent = seen.find((s) => s.url === '/api/anon/estimates');
    expect(sent.body.p).toBe(0.37);
    expect(srv.verify('C1', sent.body.token, sent.body.signature)).toBe(true);
  });

  it('both revision buttons are the same plain style and size, in order, and wait for the first answer', async () => {
    const { unmount } = render(<CardView api={routes({})} card={rev()} mode="server" revise onNext={() => {}} />);
    const [k, s] = [keep(), save()];
    expect(k.className).toBe(s.className);
    expect(k.getAttribute('style')).toBe(s.getAttribute('style'));
    expect(k).not.toHaveClass('secondary');
    expect(k.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<CardView api={routes({})} card={rev({ yourEstimate: null })} mode="server" revise onNext={() => {}} />);
    expect(keep()).toBeDisabled();
    expect(save()).toBeDisabled();
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
    const a = routes({ 'GET /api/me/profile': fail(401, 'session invalid or expired'), 'GET /api/pulse': fail(401, 'session invalid or expired'), 'GET /api/inbox': fail(401, 'session invalid or expired') });
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

  it('an invite link in the address starts onboarding, signs in, saves the profile with the new session, and clears the link from the address bar', async () => {
    window.history.replaceState(null, '', '/#invite=abc');
    const a = routes({
      'GET /api/consent/identified': { version: '2026-11-v3', text: 'Consent 2026-11-v3 - Known' },
      'POST /api/invite/redeem': () => ({ sessionToken: 'newtok', mode: 'server', level: 'identified' }),
      'GET /api/me/profile': { needsSetup: false },
      'GET /api/pulse': EMPTY_PULSE,
      'GET /api/inbox': emptyInbox({ toAnswer: [card()] }),
    });
    const fetched = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetched);
    try {
      render(<App api={a} />);
      expect(await screen.findByText('Your invitation was recognised.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await userEvent.type(screen.getByLabelText('Search countries'), 'Chad');
      await userEvent.click(screen.getByRole('button', { name: 'Chad' }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await userEvent.click(await screen.findByRole('radio', { name: /^Known/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await userEvent.click(await screen.findByLabelText(/I have read this/));
      await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Questions' }));
      expect(await screen.findByText(/Cholera cases in Chad/)).toBeInTheDocument();
      expect(window.location.hash).toBe('');
      expect(await kvGet('session.expert')).toBe('newtok');
      expect(fetched).toHaveBeenCalledWith('/api/me/profile', expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ authorization: 'Bearer newtok' }),
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the landing offers an invitation, which opens the wizard at the invitation step', async () => {
    render(<App api={routes({})} />);
    await userEvent.click(await screen.findByRole('button', { name: 'I have an invitation' }));
    expect(await screen.findByLabelText('Paste your invitation link or code')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your invitation' })).toBeInTheDocument();
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
    const a = routes({ 'GET /api/me/profile': { needsSetup: false }, 'GET /api/pulse': EMPTY_PULSE, 'GET /api/inbox': emptyInbox() });
    render(<App api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Questions' }));
    await screen.findByText(/New questions/);
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText(/You are offline. You can still answer/)).toBeInTheDocument();
  });
});

describe('the wizard follows what the deployment offers', () => {
  const CONSENTS = {
    'GET /api/consent/anonymous': { version: '2026-11-v3', text: 'ANON TEXT' },
    'GET /api/consent/anonymous?mode=device': { version: '2026-11-v3', text: 'DEVICE TEXT' },
  };
  const DEVICE_OPTION = /Keep my key on this device only/;

  beforeEach(() => { resetConfigCache(); window.history.replaceState(null, '', '/#invite=abc'); });
  afterEach(() => { vi.unstubAllGlobals(); resetConfigCache(); });

  /** The config route answers `flags`; any other network request fails. */
  function serveConfig(flags) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/config') return json(flags);
      throw new TypeError('no network in this test');
    }));
  }

  /** From the recognised invitation, through the expertise step, to the Anonymous card. The app must be rendered. */
  async function reachAnonymous() {
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Search countries'), 'Chad');
    await userEvent.click(screen.getByRole('button', { name: 'Chad' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('radio', { name: /^Anonymous/ }));
  }

  it('offers the device-held key only when the server has a blind-signing key', async () => {
    serveConfig({ demo: false, deviceKeys: false, breakGlass: false });
    const { unmount } = render(<App api={routes(CONSENTS)} />);
    await reachAnonymous();
    expect(screen.queryByLabelText(DEVICE_OPTION)).toBeNull();
    unmount();

    resetConfigCache();
    serveConfig({ demo: false, deviceKeys: true, breakGlass: false });
    render(<App api={routes(CONSENTS)} />);
    await reachAnonymous();
    expect(await screen.findByLabelText(DEVICE_OPTION)).toBeInTheDocument();
  });

  it('shows Loading, and no invitation step, until the config has arrived', async () => {
    let answer = /** @type {(r: Response) => void} */ (() => {});
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { answer = resolve; })));
    render(<App api={routes(CONSENTS)} />);
    await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument());
    expect(screen.queryByText('Your invitation was recognised.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await act(async () => { answer(json({ demo: false, deviceKeys: true, breakGlass: false })); });
    expect(await screen.findByText('Your invitation was recognised.')).toBeInTheDocument();
  });

  it('a failed config request hides the device-held key (fail closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    render(<App api={routes(CONSENTS)} />);
    await reachAnonymous();
    expect(screen.queryByLabelText(DEVICE_OPTION)).toBeNull();
  });

  it('the anonymous safety line says two moderators can open it only when the override key is configured', async () => {
    serveConfig({ demo: false, deviceKeys: false, breakGlass: false });
    const { unmount } = render(<App api={routes(CONSENTS)} />);
    await reachAnonymous();
    let panel = await screen.findByRole('region', { name: 'What each audience sees' });
    expect(panel).toHaveTextContent('Nobody at ACAPS can open an anonymous objection back to you.');
    expect(panel).not.toHaveTextContent(/two moderators/);
    unmount();

    resetConfigCache();
    serveConfig({ demo: false, deviceKeys: false, breakGlass: true });
    render(<App api={routes(CONSENTS)} />);
    await reachAnonymous();
    panel = await screen.findByRole('region', { name: 'What each audience sees' });
    expect(panel).toHaveTextContent('two moderators together can open the sealed note');
  });
});
