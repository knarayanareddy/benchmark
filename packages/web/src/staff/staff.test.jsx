import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffApp } from './StaffApp.jsx';
import { Cards } from './Cards.jsx';
import { Dissents } from './Dissents.jsx';
import { BreakGlass } from './BreakGlass.jsx';
import { Invites } from './Invites.jsx';
import { routes, fail } from '../test-helpers.js';
import { kvGet, kvSet } from '../lib/kv.js';

const MOD = { id: 'mod1', role: 'moderator' };
const REASON = 'The objection describes an immediate threat to the sender.';
beforeEach(() => { window.history.replaceState(null, '', '/staff'); });

describe('sign-in', () => {
  it('shows the SSO link first, and signs in with the pilot credential when SSO is off', async () => {
    let signedIn = false;
    const a = routes({
      'GET /api/staff/me': () => { if (!signedIn) throw Object.assign(new Error('nope'), { status: 401 }); return MOD; },
      'POST /api/staff/session': (b) => { expect(b).toEqual({ credential: 'pilot' }); signedIn = true; return { sessionToken: 'st' }; },
      'GET /api/staff/cards': [],
    });
    render(<StaffApp api={a} />);
    expect(await screen.findByRole('link', { name: 'Sign in with SSO' })).toHaveAttribute('href', '/api/staff/oidc/login');
    await userEvent.click(screen.getByText(/Pilot credential/));
    await userEvent.type(screen.getByLabelText('Credential'), 'pilot');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Signed in as mod1 \(moderator\)/)).toBeInTheDocument();
    expect(await kvGet('session.staff')).toBe('st');
  });

  it('takes the SSO token from the URL fragment and removes it from the address bar', async () => {
    window.history.replaceState(null, '', '/staff#token=fromsso');
    const a = routes({ 'GET /api/staff/me': MOD, 'GET /api/staff/cards': [] });
    render(<StaffApp api={a} />);
    expect(await screen.findByText(/Signed in as mod1/)).toBeInTheDocument();
    expect(await kvGet('session.staff')).toBe('fromsso');
    expect(window.location.hash).toBe('');
  });

  it('signing out forgets the session', async () => {
    await kvSet('session.staff', 'st');
    const a = routes({ 'GET /api/staff/me': MOD, 'GET /api/staff/cards': [] });
    render(<StaffApp api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: 'Sign in with SSO' })).toBeInTheDocument();
    expect(await kvGet('session.staff')).toBeUndefined();
  });
});

describe('cards', () => {
  const fill = async (over = {}) => {
    const v = { Statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.', 'Country (ISO code)': 'TCD', 'Named resolver': 'R. Resolver', ...over };
    for (const [label, text] of Object.entries(v)) await userEvent.type(screen.getByLabelText(label), text);
    await userEvent.type(screen.getByLabelText('Window starts'), '2026-11-01');
    await userEvent.type(screen.getByLabelText('Window ends'), '2027-04-30');
  };

  it('shows why a card cannot open, with every problem', async () => {
    const a = routes({ 'GET /api/staff/cards': [], 'POST /api/staff/cards': fail(400, 'card cannot open: a written objective is required', { problems: ['a written objective (what counts as yes) is required before a card opens'] }) });
    render(<Cards api={a} />);
    await screen.findByText('No cards yet.');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create card' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a written objective');
  });

  it('creates a card with the author’s objective, source and resolver, and lists it', async () => {
    let cards = [];
    const a = routes({
      'GET /api/staff/cards': () => cards,
      'POST /api/staff/cards': (b) => {
        expect(b).toMatchObject({ country: 'TCD', resolutionSource: 'IPC', resolver: 'R. Resolver', objective: 'WHO bulletin above 10,000', window: { from: '2026-11-01', to: '2027-04-30' } });
        cards = [{ id: 'C9', statement: b.statement, status: 'open', round: 1, responses: 0 }];
        return { card: cards[0], warnings: [] };
      },
    });
    render(<Cards api={a} />);
    await screen.findByText('No cards yet.');
    await fill();
    await userEvent.type(screen.getByLabelText(/Objective/), 'WHO bulletin above 10,000');
    await userEvent.selectOptions(screen.getByLabelText('Resolution source'), 'IPC');
    await userEvent.click(screen.getByRole('button', { name: 'Create card' }));
    expect(await screen.findByText('Created C9.')).toBeInTheDocument();
    expect(await screen.findByText(/0 answers/)).toBeInTheDocument();
  });

  it('closing a round, opening round 2 and recording an outcome need the right state and evidence', async () => {
    const list = [
      { id: 'A', statement: 'open one', status: 'open', round: 1, responses: 3 },
      { id: 'B', statement: 'closed one', status: 'closed', round: 1, responses: 6 },
    ];
    const a = routes({
      'GET /api/staff/cards': list,
      'POST /api/staff/cards/A/close': { ok: 1 }, 'POST /api/staff/cards/B/round2': { ok: 1 },
      'POST /api/staff/cards/B/resolve': (b) => { expect(b).toEqual({ outcome: 0, evidenceUrl: 'https://acleddata.com/x' }); return {}; },
    });
    render(<Cards api={a} />);
    const rowA = (await screen.findByText('open one')).closest('tr');
    expect(within(rowA).queryByRole('button', { name: 'Open round 2' })).toBeNull();
    await userEvent.click(within(rowA).getByRole('button', { name: 'Close round' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/staff/cards/A/close'));
    const rowB = screen.getByText('closed one').closest('tr');
    expect(within(rowB).queryByRole('button', { name: 'Close round' })).toBeNull();
    await userEvent.click(within(rowB).getByRole('button', { name: 'Open round 2' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/staff/cards/B/round2'));
    await userEvent.click(within(rowB).getByRole('button', { name: 'Resolve' }));
    await userEvent.selectOptions(within(rowB).getByLabelText('Outcome'), '0');
    await userEvent.type(within(rowB).getByLabelText(/Evidence link/), 'https://acleddata.com/x');
    await userEvent.click(within(rowB).getByRole('button', { name: 'Record outcome' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/staff/cards/B/resolve', { outcome: 0, evidenceUrl: 'https://acleddata.com/x' }));
  });
});

describe('objections', () => {
  it('offers only the step that is valid for each state, and sends the version it saw', async () => {
    const list = [
      { id: 'd1', status: 'open', kind: 'window', by: 'Analyst 7323', cardId: 'C1', text: 'too long', version: 0 },
      { id: 'd2', status: 'routed', kind: 'two_risks', by: 'anonymous', cardId: 'C1', text: 'split it', version: 1 },
    ];
    const a = routes({ 'GET /api/staff/dissents': list, 'POST /api/staff/dissents/d1/route': { ok: 1 }, 'POST /api/staff/dissents/d2/act': (b) => { expect(b).toMatchObject({ expectedVersion: 1, action: 'split', statements: ['one', 'two'] }); return {}; } });
    render(<Dissents api={a} />);
    const d1 = (await screen.findByText('too long')).closest('.card');
    expect(within(d1).queryByRole('button', { name: 'Act' })).toBeNull();
    await userEvent.click(within(d1).getByRole('button', { name: 'Route to review' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/staff/dissents/d1/route', { expectedVersion: 0 }));
    const d2 = screen.getByText('split it').closest('.card');
    await userEvent.selectOptions(within(d2).getByLabelText('Action'), 'split');
    await userEvent.type(within(d2).getByLabelText('New statements'), 'one{enter}two');
    await userEvent.click(within(d2).getByRole('button', { name: 'Act' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/staff/dissents/d2/act', expect.objectContaining({ expectedVersion: 1 })));
  });

  it('a concurrent edit is reported, not swallowed', async () => {
    const a = routes({ 'GET /api/staff/dissents': [{ id: 'd1', status: 'open', kind: 'window', by: 'x', cardId: 'C1', text: 't', version: 0 }], 'POST /api/staff/dissents/d1/route': fail(409, 'dissent d1 changed: you saw version 0, it is now 1') });
    render(<Dissents api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Route to review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('you saw version 0');
  });
});

describe('safety override', () => {
  const sealed = { id: 'd1', status: 'open', kind: 'window', by: 'anonymous', cardId: 'C1', text: 'I am being followed', version: 0, canBreakGlass: true };
  const plain = { id: 'd2', status: 'open', kind: 'window', by: 'Analyst 1', cardId: 'C1', text: 'pseudonymous one', version: 0, canBreakGlass: false };

  it('only moderators see it', () => {
    render(<BreakGlass api={routes({ 'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [] })} me={{ id: 'an1', role: 'analyst' }} />);
    expect(screen.getByText('Only moderators can use this.')).toBeInTheDocument();
  });

  it('offers only objections that have a sealed note, and asks for a real reason and a category', async () => {
    const a = routes({
      'GET /api/staff/dissents': [sealed, plain], 'GET /api/staff/breakglass': [],
      'POST /api/staff/breakglass': (b) => { expect(b).toEqual({ dissentId: 'd1', category: 'safety_welfare', reason: REASON }); return { id: 'bg1' }; },
    });
    render(<BreakGlass api={a} me={MOD} />);
    const pick = await screen.findByLabelText('Objection');
    expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'C1: I am being followed']);
    expect(screen.getByRole('button', { name: 'Request' })).toBeDisabled();
    await userEvent.selectOptions(pick, 'd1');
    await userEvent.selectOptions(screen.getByLabelText('Kind of concern'), 'safety_welfare');
    await userEvent.type(screen.getByLabelText(/Reason/), REASON);
    await userEvent.click(screen.getByRole('button', { name: 'Request' }));
    expect(await screen.findByText(/A different moderator must now approve it/)).toBeInTheDocument();
  });

  it('the requester cannot approve their own request; another moderator can approve or deny it', async () => {
    const req = { id: 'bg1', status: 'requested', category: 'safety_threat', dissentId: 'd1', requester: 'mod1', approver: null, reason: REASON };
    const a1 = routes({ 'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [req] });
    const { unmount } = render(<BreakGlass api={a1} me={MOD} />);
    expect(await screen.findByText('A different moderator must decide.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    unmount();
    const a2 = routes({ 'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [req], 'POST /api/staff/breakglass/bg1/decide': (b) => { expect(b.approve).toBe(true); return {}; } });
    render(<BreakGlass api={a2} me={{ id: 'mod2', role: 'moderator' }} />);
    expect(await screen.findByRole('button', { name: 'Deny' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(a2).toHaveBeenCalledWith('POST', '/api/staff/breakglass/bg1/decide', { approve: true, note: 'approved' }));
  });

  it('only the requester can collect an approved request, supplying the key, and sees the sender once', async () => {
    const approved = { id: 'bg1', status: 'approved', category: 'safety_threat', dissentId: 'd1', requester: 'mod1', approver: 'mod2', reason: REASON };
    const other = routes({ 'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [approved] });
    const { unmount } = render(<BreakGlass api={other} me={{ id: 'mod2', role: 'moderator' }} />);
    await screen.findByText(/decided by mod2/);
    expect(screen.queryByRole('button', { name: /Open the sealed note/ })).toBeNull();
    unmount();
    const a = routes({
      'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [approved],
      'POST /api/staff/breakglass/bg1/collect': (b) => { expect(b).toEqual({ key: '-----BEGIN PRIVATE KEY-----' }); return { expertId: 'ex_1', name: 'Amina Okoro', countries: ['TCD'], notified: true }; },
    });
    render(<BreakGlass api={a} me={MOD} />);
    await userEvent.type(await screen.findByLabelText(/private key/), '-----BEGIN PRIVATE KEY-----');
    await userEvent.click(screen.getByRole('button', { name: /Open the sealed note once/ }));
    expect(await screen.findByText('Amina Okoro')).toBeInTheDocument();
    expect(screen.getByText(/shown once and stored nowhere/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open the sealed note/ })).toBeNull();
  });

  it('says when the sender has erased their account, and a wrong key is shown as an error', async () => {
    const approved = { id: 'bg1', status: 'approved', category: 'safety_threat', dissentId: 'd1', requester: 'mod1', approver: 'mod2', reason: REASON };
    const a = routes({ 'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [approved], 'POST /api/staff/breakglass/bg1/collect': fail(400, 'could not open the sealed note: wrong key') });
    render(<BreakGlass api={a} me={MOD} />);
    await userEvent.click(await screen.findByRole('button', { name: /Open the sealed note once/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong key');
    const gone = routes({ 'GET /api/staff/dissents': [], 'GET /api/staff/breakglass': [approved], 'POST /api/staff/breakglass/bg1/collect': { erased: true } });
    const { container } = render(<BreakGlass api={gone} me={MOD} />);
    await userEvent.click(await within(container).findByRole('button', { name: /Open the sealed note once/ }));
    expect(await screen.findByText(/nobody to identify/)).toBeInTheDocument();
  });
});

describe('invites', () => {
  it('creates a one-time link, and re-invites a returning expert without changing anything about them', async () => {
    const a = routes({
      'GET /api/staff/experts': [{ id: 'ex_1', name: 'Amina', countries: ['TCD'], joined: true }, { id: 'ex_2', name: null, countries: ['SDN'], joined: false }],
      'POST /api/staff/invites': (b) => { expect(b).toEqual({ name: undefined, declaration: { countries: ['TCD', 'SDN'], themes: [] } }); return { token: 'newtoken' }; },
      'POST /api/staff/experts/ex_1/reinvite': { token: 'backtoken' },
    });
    render(<Invites api={a} me={MOD} />);
    await userEvent.type(await screen.findByLabelText(/Countries/), 'TCD, SDN');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect((await screen.findByTestId('invite-link')).textContent).toBe(`${window.location.origin}/#invite=newtoken`);
    const row = screen.getByText('Amina').closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'New link' }));
    await waitFor(() => expect(screen.getByTestId('invite-link').textContent).toContain('backtoken'));
    expect(within(screen.getByText('ex_2').closest('tr')).queryByRole('button', { name: 'New link' })).toBeNull();
  });

  it('shows the service refusing a missing country, and is moderator-only', async () => {
    const a = routes({ 'GET /api/staff/experts': [], 'POST /api/staff/invites': fail(400, 'a Declaration needs at least one country') });
    render(<Invites api={a} me={MOD} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create invite link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one country');
    render(<Invites api={routes({ 'GET /api/staff/experts': [] })} me={{ id: 'an', role: 'analyst' }} />);
    expect(screen.getByText('Only moderators can invite.')).toBeInTheDocument();
  });
});
