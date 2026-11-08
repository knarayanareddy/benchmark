import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getConfig, resetConfigCache } from './lib/config.js';
import { DemoBanner } from './DemoBanner.jsx';
import { Join } from './expert/Join.jsx';
import { routes, fail, json } from './test-helpers.js';
import { getSecret, hasDeviceSecret } from './lib/device.js';
import { decodeRecovery } from './lib/recovery.js';

const CONFIG = { demo: true, deviceKeys: false, breakGlass: false, demoLabels: true };
const PRESENTER = { ...CONFIG, demoLabels: false };
const OFF = { demo: false, deviceKeys: false, breakGlass: false, demoLabels: true };
const VERSION = '2026-11-v3';
const CONSENT = { version: VERSION, text: 'CONSENT TEXT' };
const CONSENTS = {
  'GET /api/consent/pseudonymous': CONSENT,
  'GET /api/consent/anonymous': CONSENT,
  'GET /api/consent/anonymous?mode=device': { version: VERSION, text: 'DEVICE CONSENT' },
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

  it('keeps only the four flags, even if the server sent anything else', async () => {
    stubFetch(async () => json({ demo: true, deviceKeys: false, breakGlass: false, demoLabels: true, demoStaff: ['demo-secret-credential'] }));
    const cfg = await getConfig();
    expect(cfg).toEqual(CONFIG);
    expect(Object.keys(cfg).sort()).toEqual(['breakGlass', 'demo', 'demoLabels', 'deviceKeys']);
  });

  it('passes deviceKeys and breakGlass through when the server says true', async () => {
    stubFetch(async () => json({ demo: false, deviceKeys: true, breakGlass: true }));
    expect(await getConfig()).toEqual({ demo: false, deviceKeys: true, breakGlass: true, demoLabels: true });
  });

  it('passes demoLabels through when the server says false (presenter mode)', async () => {
    stubFetch(async () => json(PRESENTER));
    expect(await getConfig()).toEqual(PRESENTER);
  });

  it('fails closed on demoLabels: anything but a literal false keeps the label on', async () => {
    stubFetch(async () => json({ demo: true, demoLabels: 0 }));
    expect(await getConfig()).toEqual({ ...CONFIG, demoLabels: true });
    resetConfigCache();
    stubFetch(async () => json({ demo: true }));
    expect(await getConfig()).toEqual({ ...CONFIG, demoLabels: true });
  });

  it('counts any non-boolean or missing flag as off, so only a literal true turns a flag on', async () => {
    stubFetch(async () => json({ demo: 'yes', deviceKeys: 1, breakGlass: 'true' }));
    expect(await getConfig()).toEqual(OFF);
    resetConfigCache();
    stubFetch(async () => json({ deviceKeys: true }));
    expect(await getConfig()).toEqual({ demo: false, deviceKeys: true, breakGlass: false, demoLabels: true });
  });

  it('fails closed on a malformed body: every flag off, device-held key and override not offered', async () => {
    stubFetch(async () => new Response('not json', { status: 200 }));
    expect(await getConfig()).toEqual(OFF);
  });

  it('falls back to not-demo when the request fails', async () => {
    stubFetch(async () => { throw new TypeError('network down'); });
    expect(await getConfig()).toEqual(OFF);
  });

  it('falls back to not-demo on an error status', async () => {
    stubFetch(async () => json({ error: 'boom' }, 500));
    expect(await getConfig()).toEqual(OFF);
  });

  it('a failed request turns deviceKeys and breakGlass off too, and returns a fresh object each time', async () => {
    stubFetch(async () => { throw new TypeError('network down'); });
    const a = await getConfig();
    a.deviceKeys = true;
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

describe('DemoBanner in presenter mode', () => {
  it('renders nothing when demoLabels is false, on the expert and the staff screen', async () => {
    stubFetch(async () => json(PRESENTER));
    const { container } = render(<DemoBanner />);
    await settle();
    expect(container).toBeEmptyDOMElement();
    const staff = render(<DemoBanner staff />);
    await settle();
    expect(staff.container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Staff credentials/)).toBeNull();
  });

  it('still shows the banner when the config has no demoLabels field (an older server): the label stays on', async () => {
    stubFetch(async () => json({ demo: true, deviceKeys: false, breakGlass: false }));
    render(<DemoBanner />);
    expect(await screen.findByRole('status')).toHaveTextContent('Demo data: these questions and the panel are made up');
  });
});

describe('Join in presenter mode', () => {
  it('hides the demo notice when demoLabels is false, but keeps the example hint and the name field', async () => {
    render(<Join api={routes(CONSENTS)} invite={null} demo demoLabels={false} deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/This is a demo deployment/)).toBeNull();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fill with an example' }));
    expect(screen.getByRole('status')).toHaveTextContent('Example profile, change anything you like.');
  });

  it('shows the demo notice when demoLabels is true, and by default', () => {
    const { unmount } = render(<Join api={routes(CONSENTS)} invite={null} demo demoLabels deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/This is a demo deployment/)).toBeInTheDocument();
    unmount();
    render(<Join api={routes(CONSENTS)} invite={null} demo deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/This is a demo deployment/)).toBeInTheDocument();
  });
});

describe('Join in demo mode', () => {
  /** Demo starts at the expertise step: name, then one country. */
  async function fillExpertise(name = '  Ana  ', country = 'Chad') {
    await userEvent.type(screen.getByLabelText('Your name'), name);
    await userEvent.type(screen.getByLabelText('Search countries'), country);
    await userEvent.click(screen.getByRole('button', { name: country }));
    await userEvent.clear(screen.getByLabelText('Search countries'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  /** Chooses a level and ticks the box on the confirmation step. */
  async function chooseAndAccept(level = /^Pseudonymous/) {
    await userEvent.click(await screen.findByLabelText(level));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/CONSENT TEXT|DEVICE CONSENT/);
    await userEvent.click(screen.getByLabelText(/I have read this/));
  }

  it('starts at the expertise step with the first pill done, warns that the account is real, and has no minimum-match or region control', () => {
    render(<Join api={routes(CONSENTS)} invite={null} demo deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    const pills = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(pills).toHaveLength(4);
    expect(pills[0]).toHaveTextContent(/Invitation, completed/);
    expect(pills[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { name: 'Your expertise' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your invitation' })).toBeNull();
    expect(screen.queryByLabelText('Paste your invitation link or code')).toBeNull();
    expect(screen.queryByLabelText(/Minimum match/)).toBeNull();
    expect(screen.queryByLabelText('Sahel & West/Central Africa')).toBeNull();
    expect(screen.getByText(/This is a demo deployment. Your account is real here, but the questions and the other experts are made up./)).toBeInTheDocument();
  });

  it('cannot go on without a name and a country, and cannot join until consent is ticked', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': () => ({ sessionToken: 'tok', expertId: 'e1', level: 'pseudonymous', mode: 'server' }) });
    const done = vi.fn();
    render(<Join api={a} invite={null} demo deviceKeys onDone={done} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter your name, up to 80 characters.');
    expect(alert).toHaveTextContent('Choose at least one country.');
    await fillExpertise();
    await userEvent.click(await screen.findByLabelText(/^Pseudonymous/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('CONSENT TEXT');
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the box to confirm you have read this and choose this level.');
    expect(a).not.toHaveBeenCalledWith('POST', '/api/demo/join', expect.anything());
    expect(done).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
  });

  it('posts the exact body in server mode, and passes the session on', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': () => ({ sessionToken: 'tok', expertId: 'e1', level: 'pseudonymous', mode: 'server' }) });
    const done = vi.fn();
    render(<Join api={a} invite={null} demo deviceKeys onDone={done} onCancel={vi.fn()} />);
    await fillExpertise('  Ana  ', 'Chad');
    await chooseAndAccept();
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'server', level: 'pseudonymous' }));
    expect(a).toHaveBeenCalledWith('POST', '/api/demo/join', {
      name: 'Ana',
      level: 'pseudonymous',
      mode: 'server',
      consentVersion: VERSION,
      profile: { organisation: null, roleType: null, countries: ['TCD'], themes: [], weeklyCap: 3 },
    });
  });

  it('with a device-held key, makes a secret, shows the recovery code, needs it saved, and posts mode device without the code', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': () => ({ sessionToken: 'tok', expertId: 'e1', level: 'anonymous', mode: 'device' }) });
    const done = vi.fn();
    render(<Join api={a} invite={null} demo deviceKeys onDone={done} onCancel={vi.fn()} />);
    await fillExpertise('Ana', 'Sudan');
    await userEvent.click(await screen.findByLabelText(/^Anonymous/));
    await userEvent.click(await screen.findByLabelText(/Keep my key on this device only/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('DEVICE CONSENT')).toBeInTheDocument();
    const code = (await screen.findByTestId('recovery')).textContent;
    expect(Buffer.from(decodeRecovery(code))).toEqual(Buffer.from(await getSecret()));
    await userEvent.click(screen.getByLabelText(/I have read this/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save your recovery code before using a device-held key.');
    expect(done).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText(/I have saved my recovery code/));
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ token: 'tok', mode: 'device', level: 'anonymous' }));
    expect(a).toHaveBeenCalledWith('POST', '/api/demo/join', expect.objectContaining({ name: 'Ana', level: 'anonymous', mode: 'device', consentVersion: VERSION }));
    expect(JSON.stringify(a.mock.calls)).not.toContain(code);
  });

  it('offers the device-held key only when the service has it', async () => {
    render(<Join api={routes(CONSENTS)} invite={null} demo deviceKeys={false} onDone={vi.fn()} onCancel={vi.fn()} />);
    await fillExpertise('Ana', 'Chad');
    await userEvent.click(await screen.findByLabelText(/^Anonymous/));
    await screen.findByRole('region', { name: 'What each audience sees' });
    expect(screen.queryByLabelText(/Keep my key on this device only/)).toBeNull();
  });

  it('the example fills the form and is labelled as an example, and the name stays editable', async () => {
    render(<Join api={routes(CONSENTS)} invite={null} demo deviceKeys onDone={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fill with an example' }));
    expect(screen.getByRole('status')).toHaveTextContent('Example profile, change anything you like.');
    expect(screen.getByLabelText('Your name')).toHaveValue('Example expert');
    expect(screen.getByLabelText('Search countries').closest('.country-picker')).toHaveTextContent('2 of 6 chosen');
    await userEvent.clear(screen.getByLabelText('Your name'));
    await userEvent.type(screen.getByLabelText('Your name'), 'Ana');
    expect(screen.getByLabelText('Your name')).toHaveValue('Ana');
  });

  it('shows the server refusal and does not continue', async () => {
    const a = routes({ ...CONSENTS, 'POST /api/demo/join': fail(409, 'the demo is full: 300 accounts have joined') });
    const done = vi.fn();
    render(<Join api={a} invite={null} demo deviceKeys onDone={done} onCancel={vi.fn()} />);
    await fillExpertise('Ana', 'Chad');
    await chooseAndAccept();
    await userEvent.click(screen.getByRole('button', { name: 'Join the circle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the demo is full: 300 accounts have joined');
    expect(done).not.toHaveBeenCalled();
    expect(await hasDeviceSecret()).toBe(false);
  });
});
