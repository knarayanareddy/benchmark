import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Join } from './Join.jsx';
import { routes, fail, json } from '../test-helpers.js';
import { ApiError } from '../lib/api.js';
import { getSecret, hasDeviceSecret } from '../lib/device.js';
import { decodeRecovery } from '../lib/recovery.js';
import { LEVEL_COPY } from '@benchmark/core/anonymity';
import { levelCards } from '@benchmark/core/onboarding';

const VERSION = '2026-11-v3';
const TEXT = {
  identified: 'IDENTIFIED TEXT',
  pseudonymous: 'PSEUDO TEXT',
  anonymous: 'ANON TEXT',
  device: 'DEVICE TEXT',
};
const CONSENTS = {
  'GET /api/consent/identified': { version: VERSION, text: TEXT.identified },
  'GET /api/consent/pseudonymous': { version: VERSION, text: TEXT.pseudonymous },
  'GET /api/consent/anonymous': { version: VERSION, text: TEXT.anonymous },
  'GET /api/consent/anonymous?mode=device': { version: VERSION, text: TEXT.device },
};
const REDEEMED = { sessionToken: 'tok', mode: 'server', level: 'pseudonymous' };
const REASON_ANON = 'You cover a context where being named can put people at risk.';
const REASON_PSEUDO = 'A stable alias lets colleagues follow your reasoning while keeping your name from them.';
const BAD_TOKEN = /does not look like an invitation link or code/;

beforeEach(() => {
  // Every profile save goes through fetch. Stub it so no test reaches a real network.
  vi.stubGlobal('fetch', vi.fn(async () => json({})));
});
afterEach(() => vi.unstubAllGlobals());

/** The api the wizard talks to, with every route it needs. @param {Record<string, any>} [extra] */
function api(extra = {}) {
  return routes({ ...CONSENTS, 'POST /api/invite/redeem': () => REDEEMED, ...extra });
}

/** @param {string} name a country name as the picker shows it */
async function addCountry(name) {
  const search = screen.getByLabelText('Search countries');
  await userEvent.type(search, name);
  await userEvent.click(screen.getByRole('button', { name }));
  await userEvent.clear(search);
}

async function next() { await userEvent.click(screen.getByRole('button', { name: 'Continue' })); }

/** The label that wraps a visibility card, found from its radio. */
const cardOf = (/** @type {RegExp} */ name) => screen.getByRole('radio', { name }).closest('label');

/** Pilot, from the recognised invitation to the confirmation step with the level chosen and the consent text shown. */
async function toConfirm({ level = /^Pseudonymous/, countries = ['Chad'], text = TEXT.pseudonymous } = {}) {
  await next();
  for (const c of countries) await addCountry(c);
  await next();
  await userEvent.click(screen.getByLabelText(level));
  await next();
  expect(await screen.findByText(text)).toBeInTheDocument();
}

/** Pilot, through to submitting with the box ticked. */
async function finishPilot(opts) {
  await toConfirm(opts);
  await userEvent.click(screen.getByLabelText(/I have read this/));
  await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
}

/** @param {Record<string, any>} [over] */
function renderPilot(a, over = {}) {
  const props = { api: a, invite: 'inv', demo: false, deviceKeys: true, onDone: vi.fn(), onCancel: vi.fn(), ...over };
  render(<Join {...props} />);
  return props;
}

describe('the four steps', () => {
  it('shows the four pills with the first step current, and Back and Continue move between steps', async () => {
    renderPilot(api());
    const pills = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(pills).toHaveLength(4);
    expect(pills[0]).toHaveAttribute('aria-current', 'step');
    await next();
    expect(screen.getByRole('heading', { name: 'Your expertise' })).toBeInTheDocument();
    const after = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(after[0]).toHaveTextContent(/Invitation, completed/);
    expect(after[1]).toHaveAttribute('aria-current', 'step');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Your invitation' })).toBeInTheDocument();
  });

  it('moves focus to the step heading on each change of step, and not on the first render', async () => {
    renderPilot(api());
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Your invitation' }));
    await next();
    expect(screen.getByRole('heading', { name: 'Your expertise' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Your invitation' })).toHaveFocus();
  });

  it('on the first step, Back leaves the wizard', async () => {
    const { onCancel } = renderPilot(api());
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('each step shows its problems in role=alert and does not move on', async () => {
    renderPilot(api(), { invite: null });
    await next();
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste your invitation link or code to continue.');
    expect(screen.getByRole('heading', { name: 'Your invitation' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Paste your invitation link or code'), 'abc');
    await next();
    expect(screen.getByRole('heading', { name: 'Your expertise' })).toBeInTheDocument();
    await next();
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one country.');
    expect(screen.getByRole('heading', { name: 'Your expertise' })).toBeInTheDocument();
  });

  it('a step with no level chosen says so', async () => {
    renderPilot(api());
    await next(); await addCountry('Chad'); await next();
    await next();
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose how you are shown: Known, Pseudonymous or Anonymous.');
  });
});

describe('invitation', () => {
  it('says the invitation was recognised when the address carries one, with no paste field', () => {
    renderPilot(api());
    expect(screen.getByRole('status')).toHaveTextContent('Your invitation was recognised.');
    expect(screen.queryByLabelText('Paste your invitation link or code')).toBeNull();
  });

  it('offers a paste field when the address carries no invitation', () => {
    renderPilot(api(), { invite: null });
    expect(screen.getByLabelText('Paste your invitation link or code')).toBeInTheDocument();
    expect(screen.queryByText('Your invitation was recognised.')).toBeNull();
  });

  it('accepts a pasted link containing invite=, and sends only the token', async () => {
    const a = api();
    renderPilot(a, { invite: null });
    await userEvent.type(screen.getByLabelText('Paste your invitation link or code'), 'https://benchmark.example/#invite=abc123');
    await finishPilot();
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.objectContaining({ token: 'abc123' })));
  });

  it('trims spaces around a pasted code', async () => {
    const a = api();
    renderPilot(a, { invite: null });
    await userEvent.type(screen.getByLabelText('Paste your invitation link or code'), '   tok9   ');
    await finishPilot();
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.objectContaining({ token: 'tok9' })));
  });

  it('refuses a pasted token with a space in it, and says so', async () => {
    const a = api();
    renderPilot(a, { invite: null });
    await userEvent.type(screen.getByLabelText('Paste your invitation link or code'), 'abc def');
    await next();
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD_TOKEN);
    expect(a).not.toHaveBeenCalled();
  });

  it('an invitation in the address that has a space in it is not recognised, and the paste field is offered', () => {
    renderPilot(api(), { invite: 'a b' });
    expect(screen.queryByText('Your invitation was recognised.')).toBeNull();
    expect(screen.getByLabelText('Paste your invitation link or code')).toBeInTheDocument();
  });
});

describe('expertise (pilot)', () => {
  it('has no name field: the pilot name comes from the invitation staff wrote', async () => {
    renderPilot(api());
    await next();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill with an example' })).toBeNull();
  });

  it('organisation is optional and says only you see it', async () => {
    renderPilot(api());
    await next();
    expect(screen.getByLabelText('Organisation (optional)')).toBeInTheDocument();
    expect(screen.getByText('Only you see this.')).toBeInTheDocument();
  });

  it('countries are searched and chosen by name, accent-insensitive, never by typed codes', async () => {
    renderPilot(api());
    await next();
    await userEvent.type(screen.getByLabelText('Search countries'), 'sao tome');
    expect(screen.getByRole('button', { name: 'São Tomé and Príncipe' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search countries'));
    await addCountry('Sudan');
    expect(screen.getByText('1 of 6 chosen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sudan', pressed: true })).toBeInTheDocument();
  });

  it('at most six countries: the seventh is refused, with the count shown', async () => {
    renderPilot(api());
    await next();
    for (const c of ['Chad', 'Sudan', 'Yemen', 'Kenya', 'Somalia', 'Mali']) await addCountry(c);
    expect(screen.getByText('6 of 6 chosen')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search countries'), 'Niger');
    expect(screen.getByRole('button', { name: 'Niger' })).toBeDisabled();
  });

  it('the role is one choice, and themes are several', async () => {
    renderPilot(api());
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Researcher / academic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Local NGO leader' }));
    expect(screen.getByRole('button', { name: 'Local NGO leader', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Researcher / academic', pressed: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conflict & security' }));
    await userEvent.click(screen.getByRole('button', { name: 'Health & outbreaks' }));
    expect(screen.getByRole('button', { name: 'Conflict & security', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Health & outbreaks', pressed: true })).toBeInTheDocument();
  });
});

describe('visibility', () => {
  it('the three cards are one radio group with real radio buttons', async () => {
    renderPilot(api());
    await next(); await addCountry('Chad'); await next();
    const group = screen.getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /^Known/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Pseudonymous/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Anonymous/ })).toBeInTheDocument();
  });

  it('the panel shows the selected card: the wording is the LEVEL_COPY wording, from levelCards', async () => {
    renderPilot(api());
    await next(); await addCountry('Kenya'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Pseudonymous/ }));
    const panel = screen.getByRole('region', { name: 'What each audience sees' });
    const card = levelCards().find((c) => c.level === 'pseudonymous');
    expect(card.audiences.map((a) => a.text)).toContain(LEVEL_COPY.pseudonymous.toAcaps);
    expect(panel).toHaveTextContent(LEVEL_COPY.pseudonymous.toAcaps);
    expect(panel).toHaveTextContent(LEVEL_COPY.pseudonymous.toPeers);
    expect(panel).toHaveTextContent(LEVEL_COPY.pseudonymous.warn);
    for (const a of card.audiences) expect(panel).toHaveTextContent(a.text);
    expect(panel).toHaveTextContent('Aggregates only, and only when at least 10 people are in a group.');
    await userEvent.click(screen.getByRole('radio', { name: /^Known/ }));
    expect(screen.getByRole('region', { name: 'What each audience sees' })).toHaveTextContent(LEVEL_COPY.identified.toAcaps);
    expect(screen.getByRole('region', { name: 'What each audience sees' })).not.toHaveTextContent(LEVEL_COPY.pseudonymous.toAcaps);
  });

  it('no level card or panel ever says ACAPS does not know who the person is', async () => {
    const { container } = render(<Join api={api()} invite="inv" demo={false} deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    await next(); await addCountry('Chad'); await next();
    for (const re of [/^Known/, /^Pseudonymous/, /^Anonymous/]) {
      await userEvent.click(screen.getByRole('radio', { name: re }));
      expect(container.textContent).not.toMatch(/doesn['’]t know who I am/i);
    }
  });

  it('the Recommended tag moves to Anonymous for a sensitive country, with the reason, and back when it is removed', async () => {
    renderPilot(api());
    await next(); await addCountry('Kenya'); await next();
    expect(within(cardOf(/^Pseudonymous/)).getByText('Recommended for you')).toBeInTheDocument();
    expect(within(cardOf(/^Pseudonymous/)).getByText(REASON_PSEUDO)).toBeInTheDocument();
    expect(within(cardOf(/^Anonymous/)).queryByText('Recommended for you')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await addCountry('Chad');
    await next();
    expect(within(cardOf(/^Anonymous/)).getByText('Recommended for you')).toBeInTheDocument();
    expect(within(cardOf(/^Anonymous/)).getByText(REASON_ANON)).toBeInTheDocument();
    expect(within(cardOf(/^Pseudonymous/)).queryByText('Recommended for you')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Chad' }));
    await next();
    expect(within(cardOf(/^Pseudonymous/)).getByText('Recommended for you')).toBeInTheDocument();
    expect(within(cardOf(/^Anonymous/)).queryByText('Recommended for you')).toBeNull();
  });

  it('fetches the consent for each level and for the device mode as they are chosen', async () => {
    const a = api();
    renderPilot(a, { deviceKeys: true });
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Pseudonymous/ }));
    expect(a).toHaveBeenCalledWith('GET', '/api/consent/pseudonymous');
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    expect(a).toHaveBeenCalledWith('GET', '/api/consent/anonymous');
    await userEvent.click(await screen.findByLabelText(/Keep my key on this device only/));
    await waitFor(() => expect(a).toHaveBeenCalledWith('GET', '/api/consent/anonymous?mode=device'));
  });
});

describe('device-held key', () => {
  it('is offered only to anonymous experts, and only when the service has it', async () => {
    const { rerender } = render(<Join api={api()} invite="inv" demo={false} deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Known/ }));
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    expect(await screen.findByLabelText(/Keep my key on this device only/)).toBeInTheDocument();
    rerender(<Join api={api()} invite="inv" demo={false} deviceKeys={false} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
  });

  it('a device-held key creates a secret, shows its recovery code on the confirmation step, and needs it saved', async () => {
    const a = api();
    const done = vi.fn();
    renderPilot(a, { onDone: done });
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    await userEvent.click(await screen.findByLabelText(/Keep my key on this device only/));
    await next();
    expect(await screen.findByText(TEXT.device)).toBeInTheDocument();
    const code = (await screen.findByTestId('recovery')).textContent;
    expect(code).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{2}$/);
    expect(Buffer.from(decodeRecovery(code))).toEqual(Buffer.from(await getSecret()));
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save your recovery code before using a device-held key.');
    expect(done).not.toHaveBeenCalled();
    expect(a).not.toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.anything());
    await userEvent.click(screen.getByLabelText(/I have saved my recovery code/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(a).toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.objectContaining({ token: 'inv', mode: 'device', consentVersion: VERSION }));
    expect(JSON.stringify(a.mock.calls)).not.toContain(code);
  });

  it('switching the device key off removes the secret it had made', async () => {
    renderPilot(api());
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    const box = await screen.findByLabelText(/Keep my key on this device only/);
    await userEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(await hasDeviceSecret()).toBe(true);
    await userEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(await hasDeviceSecret()).toBe(false);
  });

  it('choosing another level switches the device key off, and removes the secret', async () => {
    renderPilot(api());
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    await userEvent.click(await screen.findByLabelText(/Keep my key on this device only/));
    await waitFor(async () => expect(await hasDeviceSecret()).toBe(true));
    await userEvent.click(screen.getByRole('radio', { name: /^Pseudonymous/ }));
    await waitFor(async () => expect(await hasDeviceSecret()).toBe(false));
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
  });
});

describe('rhythm and confirmation', () => {
  it('shows the exact consent text, and will not join until it is accepted', async () => {
    const a = api();
    const done = vi.fn();
    renderPilot(a, { onDone: done });
    await toConfirm();
    expect(screen.getByRole('heading', { name: 'What this means for you' })).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Join the circle' });
    await userEvent.click(go);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the box to confirm you have read this and choose this level.');
    expect(a).not.toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.anything());
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(go);
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
  });

  it('the consent is the server text verbatim, in the consent block', async () => {
    const text = 'Consent 2026-11-v3 - Pseudonymous\nTo ACAPS: "quoted" and  double  spaces\nRetention: 12 months';
    renderPilot(api({ 'GET /api/consent/pseudonymous': { version: VERSION, text } }));
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Pseudonymous/ }));
    await next();
    await waitFor(() => expect(document.querySelector('pre.consent')).not.toBeNull());
    expect(document.querySelector('pre.consent').textContent).toBe(text);
  });

  it('the weekly limit offers 1, 2, 3 and 5, defaults to 3, and the chosen one is sent', async () => {
    const a = api();
    renderPilot(a);
    await toConfirm({ countries: ['Chad'] });
    expect(['1 a week', '2 a week', '3 a week', '5 a week'].map((l) => screen.getByRole('button', { name: l }))).toHaveLength(4);
    expect(screen.getByRole('button', { name: '3 a week', pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '5 a week' }));
    expect(screen.getByRole('button', { name: '5 a week', pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls[0][1].body).toContain('"weeklyCap":5');
  });

  it('the summary names the countries, and the rhythm line says what we ask about', async () => {
    renderPilot(api());
    await toConfirm({ countries: ['Chad', 'Sudan'] });
    expect(screen.getByText(/We only ask about Chad, Sudan and your chosen themes\./)).toBeInTheDocument();
    expect(screen.getByText(/You will see anything else, such as a reply to something you raised, when you visit; nothing is sent to your phone or email\./)).toBeInTheDocument();
    expect(screen.queryByText(/impact receipts|only other things we push/)).toBeNull();
    const summary = screen.getByText('Countries').closest('dl');
    expect(summary).toHaveTextContent('Chad, Sudan');
    expect(summary).not.toHaveTextContent(/TCD|SDN/);
  });
});

describe('submitting (pilot)', () => {
  it('sends the redeem body, then the profile with the new session as the bearer, with exactly the five profile fields', async () => {
    const log = [];
    const a = api({ 'POST /api/invite/redeem': () => { log.push('redeem'); return REDEEMED; } });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { log.push(`profile ${init.method} ${url}`); return json({}); }));
    const done = vi.fn();
    renderPilot(a, { onDone: done });
    await next(); await addCountry('Chad'); await userEvent.click(screen.getByRole('button', { name: 'Researcher / academic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Conflict & security' }));
    await userEvent.type(screen.getByLabelText('Organisation (optional)'), '  Acme  ');
    await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Pseudonymous/ }));
    await next();
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
    expect(log).toEqual(['redeem', 'profile PUT /api/me/profile']);
    expect(a).toHaveBeenCalledWith('POST', '/api/invite/redeem', { token: 'inv', level: 'pseudonymous', consentVersion: VERSION, mode: undefined });
    const [url, init] = fetch.mock.calls.find(([u]) => u === '/api/me/profile');
    expect(url).toBe('/api/me/profile');
    expect(init.method).toBe('PUT');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ organisation: 'Acme', roleType: 'researcher', countries: ['TCD'], themes: ['conflict'], weeklyCap: 3 });
  });

  it('a blank organisation and an unchosen role are sent as null, and no themes as an empty list', async () => {
    renderPilot(api());
    await finishPilot();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ organisation: null, roleType: null, countries: ['TCD'], themes: [], weeklyCap: 3 });
  });

  it('if the profile save fails, the person is still signed in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)));
    const done = vi.fn();
    renderPilot(api(), { onDone: done });
    await finishPilot();
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('if the network fails on the profile save, the person is still signed in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const done = vi.fn();
    renderPilot(api(), { onDone: done });
    await finishPilot();
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it('shows the service refusing the invite, and does not sign in', async () => {
    const done = vi.fn();
    renderPilot(api({ 'POST /api/invite/redeem': fail(401, 'invite already used') }), { onDone: done });
    await finishPilot();
    expect(await screen.findByRole('alert')).toHaveTextContent('invite already used');
    expect(done).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a consent that has not loaded yet blocks the join, with the reason', async () => {
    const a = api({ 'GET /api/consent/pseudonymous': () => { throw new ApiError('consent route down', { status: 500 }); } });
    renderPilot(a);
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Pseudonymous/ }));
    await next();
    expect(await screen.findByRole('alert')).toHaveTextContent('consent route down');
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    expect(await screen.findByText('The consent text has not loaded yet. Choose your level again.')).toBeInTheDocument();
    expect(a).not.toHaveBeenCalledWith('POST', '/api/invite/redeem', expect.anything());
  });
});

describe('the anonymous safety line follows the deployment (breakGlass)', () => {
  const SAFETY = 'If there is a safety concern';
  /** Pilot to the visibility step with Anonymous chosen; returns its safety line from the panel. */
  async function anonymousSafety(breakGlass) {
    renderPilot(api(), { breakGlass });
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    const panel = await screen.findByRole('region', { name: 'What each audience sees' });
    return within(panel).getByText(`${SAFETY}:`).closest('li').textContent;
  }

  it('with no safety-override key, the card says nobody at ACAPS can open it, and never mentions two moderators', async () => {
    const line = await anonymousSafety(false);
    expect(line).toContain('Nobody at ACAPS can open an anonymous objection back to you.');
    expect(line).not.toMatch(/two moderators/);
  });

  it('with a safety-override key, the card says two moderators can open the sealed note', async () => {
    const line = await anonymousSafety(true);
    expect(line).toMatch(/two moderators together can open the sealed note/);
    expect(line).not.toMatch(/Nobody at ACAPS/);
  });

  it('Join with no breakGlass prop does not promise an override (fail closed)', async () => {
    render(<Join api={api()} invite="inv" demo={false} deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    await next(); await addCountry('Chad'); await next();
    await userEvent.click(screen.getByRole('radio', { name: /^Anonymous/ }));
    const panel = await screen.findByRole('region', { name: 'What each audience sees' });
    expect(panel).not.toHaveTextContent(/two moderators/);
    expect(panel).toHaveTextContent('Nobody at ACAPS can open an anonymous objection back to you.');
  });
});
