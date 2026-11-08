import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.jsx';
import { CardView, resetLevelCache } from './CardView.jsx';
import { routes, card, fail } from '../test-helpers.js';
import { kvSet, kvGet } from '../lib/kv.js';
import { enqueue, pending, clearQueue } from '../lib/queue.js';

const PULSE = { week: { from: '2026-11-01', to: '2026-11-08' }, weeklyCap: 3, asks: [], radar: [], waiting: { revise: 0, discussion: 0, offers: 0 }, deviceMode: false };

beforeEach(async () => { window.history.replaceState(null, '', '/'); resetLevelCache(); await clearQueue(); });

describe('signing out leaves nothing of the last person behind', () => {
  it('empties the offline queue, so the next person on this phone cannot send or see it', async () => {
    await kvSet('session.expert', 'tok'); await kvSet('session.mode', 'server');
    await enqueue('C1', 0.4, { reason: 'something private I wrote', confidence: 3 });
    const a = routes({ 'GET /api/me/profile': { needsSetup: false, level: 'identified' }, 'GET /api/pulse': PULSE, 'GET /api/inbox': { toAnswer: [], openForRevision: [], notifications: [], notices: [], deviceMode: false } });
    render(<App api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/invitation-only panel/)).toBeInTheDocument();
    expect(await pending()).toEqual([]);
    expect(await kvGet('session.expert')).toBeUndefined();
  });

  it('an expired session also empties the offline queue, so it is not sent under the next person', async () => {
    await kvSet('session.expert', 'old'); await kvSet('session.mode', 'server');
    await enqueue('C1', 0.4, { reason: 'something private I wrote', confidence: 3 });
    const gone = fail(401, 'session invalid or expired');
    render(<App api={routes({ 'GET /api/me/profile': gone, 'GET /api/pulse': gone, 'GET /api/inbox': gone })} />);
    expect(await screen.findByText(/invitation-only panel/)).toBeInTheDocument();
    expect(await pending()).toEqual([]);
  });

  it('forgets the privacy label, so a person who joins next at a different level sees their own', async () => {
    const first = routes({ 'GET /api/me/profile': { level: 'pseudonymous' } });
    const { unmount } = render(<CardView api={first} card={card({ id: 'C1' })} mode="server" onNext={() => {}} />);
    expect(await screen.findByText(/This will be shown as: Pseudonymous/)).toBeInTheDocument();
    unmount();
    // What App does on sign-out and on sign-in.
    resetLevelCache();
    const second = routes({ 'GET /api/me/profile': { level: 'identified' } });
    render(<CardView api={second} card={card({ id: 'C1' })} mode="server" onNext={() => {}} />);
    expect(await screen.findByText(/This will be shown as: Known/)).toBeInTheDocument();
    expect(screen.queryByText(/Pseudonymous/)).toBeNull();
  });
});
