import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getConfig, resetConfigCache } from './lib/config.js';
import { DemoBanner } from './DemoBanner.jsx';
import { DemoJoin } from './expert/DemoJoin.jsx';
import { routes, fail, json } from './test-helpers.js';
import { getSecret } from './lib/device.js';
import { decodeRecovery } from './lib/recovery.js';

const CONFIG = { demo: true };
const OFF = { demo: false };
const CONSENT = { version: '2026-11-v2', text: 'CONSENT TEXT' };
const CONSENTS = {
  'GET /api/consent/pseudonymous': CONSENT,
  'GET /api/consent/anonymous': CONSENT,
  'GET /api/consent/anonymous?mode=device': { version: '2026-11-v2', text: 'DEVICE CONSENT' },
};

beforeEach(() => resetConfigCache());
afterEach(() => vi.unstubAllGlobals());

/** @param {(...a: any[]) => any} impl */
function stubFetch(impl) {
  const f = vi.fn(impl);
  vi.stubGlobal('fetch', f);
  return f;
}

/** Lets a config answer that is already on its way reach the component. */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('getConfig', () => {
  it('asks the public config route, with no login', async () => {
    const f = stubFetch(async () => json(CONFIG));
    expect(await getConfig()).toEqual(CONFIG);
    expect(f).toHaveBeenCalledWith('/api/config');
  });

  it('keeps only the demo flag, even if the server sent anything else', async () => {
    stubFetch(async () => json({ demo: true, demoStaff: ['demo-secret-credential'] }));
    expect(await getConfig()).toEqual(CONFIG);
  });

  it('falls back to not-demo when the request fails', async () => {
    stubFetch(async () => { throw new TypeError('network down'); });
    expect(await getConfig()).toEqual(OFF);
  });

  it('falls back to not-demo on an error status', async () => {
    stubFetch(async () => json({ error: 'boom' }, 500));
    expect(await getConfig()).toEqual(OFF);
  });

  it('caches the first success for the page, and does not cache a failure', async () => {
    const f = stubFetch(async () => {
      if (f.mock.calls.length === 1) throw new TypeError('first try fails');
      return json(CONFIG);
    });
    expect(await getConfig()).toEqual(OFF);
    expect(await getConfig()).toEqual(CONFIG);
    expect(await getConfig()).toEqual(CONFIG);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('DemoBanner', () => {
  it('renders nothing when the deployment is not in demo mode', async () => {
    stubFetch(async () => json(OFF));
    const { container } = render(<DemoBanner />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner when demo mode is on, with no staff line and no credentials', async () => {
    stubFetch(async () => json(CONFIG));
    const { container } = render(<DemoBanner />);
    expect(await screen.findByRole('status')).toHaveTextContent('Demo data: these questions and the panel are made up to show how it works. Nothing here is a result.');
    expect(container.querySelector('code')).toBeNull();
    expect(screen.queryByText(/Staff credentials/)).toBeNull();
  });

  it('the staff sign-in banner points to the server console and shows no credential', async () => {
    stubFetch(async () => json(CONFIG));
    const { container } = render(<DemoBanner staff />);
    await screen.findByRole('status');
    expect(screen.getByText('Demo deployment. Staff credentials are shown in the server console.')).toBeInTheDocument();
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).not.toMatch(/demo-|moderator|password/i);
  });
});

describe('DemoJoin', () => {
  /** Chooses a level, reads and accepts the consent, and gives a country. */
  async function fillAndAccept(level = /^Pseudonymous/, country = 'tcd') {
    await userEvent.type(screen.getByLabelText('Your name'), '  Ana  ');
    await userEvent.click(screen.getByLabelText(level));
    await screen.findByText('CONSENT TEXT');
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.type(screen.getByLabelText('Countries you cover'), country);
  }

  it('warns that the account is real and the rest is made up, and cannot submit until consent is ticked and a country is given', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': () => ({ sessionToken: 'tok', expertId: 'e1', level: 'pseudonymous', mode: 'server' }) });
    const done = vi.fn();
    render(<DemoJoin api={a} deviceKeys onDone={done} />);
    expect(screen.getByText('Try the demo')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Minimum match/)).toBeNull();
    expect(screen.queryByLabelText('Sahel & West/Central Africa')).toBeNull();
    expect(screen.getByText(/This is a demo deployment. Your account is real here, but the questions and the other experts are made up./)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Join the demo' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your name'), 'Ana');
    await userEvent.click(screen.getByLabelText(/Pseudonymous/));
    await screen.findByText('CONSENT TEXT');
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have read this/));
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Countries you cover'), 'TCD');
    expect(go).toBeEnabled();
  });

  it('posts the exact body in server mode, and passes the session on', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': () => ({ sessionToken: 'tok', expertId: 'e1', level: 'pseudonymous', mode: 'server' }) });
    const done = vi.fn();
    render(<DemoJoin api={a} deviceKeys onDone={done} />);
    await userEvent.type(screen.getByLabelText('Your name'), '  Ana  ');
    await userEvent.click(screen.getByLabelText(/Pseudonymous/));
    await screen.findByText('CONSENT TEXT');
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.type(screen.getByLabelText('Countries you cover'), 'tcd');
    await userEvent.click(screen.getByRole('button', { name: 'Join the demo' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
    expect(a).toHaveBeenCalledWith('POST', '/api/demo/join', {
      name: 'Ana',
      level: 'pseudonymous',
      mode: 'server',
      consentVersion: '2026-11-v2',
      profile: { organisation: null, roleType: null, countries: ['TCD'], themes: [], weeklyCap: 3 },
    });
  });

  it('with a device-held key, makes a secret, shows the recovery code, needs it saved, and posts mode device without the code', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': () => ({ sessionToken: 'tok', expertId: 'e1', level: 'anonymous', mode: 'device' }) });
    const done = vi.fn();
    render(<DemoJoin api={a} deviceKeys onDone={done} />);
    await userEvent.type(screen.getByLabelText('Your name'), 'Ana');
    await userEvent.click(screen.getByLabelText(/^Anonymous/));
    await userEvent.click(await screen.findByLabelText(/Keep my key on this device only/));
    expect(await screen.findByText('DEVICE CONSENT')).toBeInTheDocument();
    const code = (await screen.findByTestId('recovery')).textContent;
    expect(Buffer.from(decodeRecovery(code))).toEqual(Buffer.from(await getSecret()));
    const go = screen.getByRole('button', { name: 'Join the demo' });
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.type(screen.getByLabelText('Countries you cover'), 'SDN');
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have saved my recovery code/));
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'device', level: 'anonymous' }));
    expect(a).toHaveBeenCalledWith('POST', '/api/demo/join', expect.objectContaining({ name: 'Ana', level: 'anonymous', mode: 'device', consentVersion: '2026-11-v2' }));
    expect(JSON.stringify(a.mock.calls)).not.toContain(code);
  });

  it('offers the device-held key only when the service has it', async () => {
    render(<DemoJoin api={routes(CONSENTS)} deviceKeys={false} onDone={() => {}} />);
    await userEvent.click(screen.getByLabelText(/^Anonymous/));
    await screen.findByText('CONSENT TEXT');
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
  });

  it('shows the server refusal and does not continue', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': fail(409, 'the demo is full: 300 accounts have joined') });
    const done = vi.fn();
    render(<DemoJoin api={a} deviceKeys onDone={done} />);
    await fillAndAccept();
    await userEvent.click(screen.getByRole('button', { name: 'Join the demo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the demo is full: 300 accounts have joined');
    expect(done).not.toHaveBeenCalled();
  });
});
