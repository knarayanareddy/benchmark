import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Credits } from './Credits.jsx';
import { kvSet } from '../lib/kv.js';

afterEach(() => { vi.unstubAllGlobals(); });

const ITEMS = [
  { id: 'pub_old', text: 'An older contribution.', creditLine: null, cardStatement: 'Older statement?', country: 'SSD', day: '2026-10-02' },
  { id: 'pub_new', text: 'A newer contribution.', creditLine: 'Ann Lee, Clinic Co', cardStatement: 'Newer statement?', country: 'TCD', day: '2026-11-05' },
];

/** A fetch stub that answers the public credits route with the given response. */
function stubFetch(response) {
  const f = vi.fn(async () => response);
  vi.stubGlobal('fetch', f);
  return f;
}

describe('public credits page', () => {
  it('shows the title, the consent statement, and the items newest first with their credit', async () => {
    stubFetch(new Response(JSON.stringify(ITEMS), { status: 200 }));
    render(<Credits />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Published contributions' })).toBeInTheDocument();
    expect(screen.getByText(/published with its author’s consent/)).toBeInTheDocument();
    const entries = await screen.findAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Newer statement?');
    expect(entries[0]).toHaveTextContent('A newer contribution.');
    expect(entries[0]).toHaveTextContent('Credit: Ann Lee, Clinic Co');
    expect(entries[0]).toHaveTextContent('2026-11-05');
    expect(entries[0]).toHaveTextContent('TCD');
    expect(entries[1]).toHaveTextContent('Older statement?');
    expect(within(entries[1]).getByText('Uncredited')).toBeInTheDocument();
    expect(entries[1]).toHaveTextContent('SSD');
    expect(entries[1]).toHaveTextContent('2026-10-02');
  });

  it('shows an empty state when nothing has been published', async () => {
    stubFetch(new Response('[]', { status: 200 }));
    render(<Credits />);
    expect(await screen.findByText('Nothing has been published yet.')).toBeInTheDocument();
  });

  it('shows an error state when the list cannot be loaded', async () => {
    stubFetch(new Response('{"error":"boom"}', { status: 500 }));
    render(<Credits />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load published contributions');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('makes a plain request with no Authorization header, even when a login token is stored', async () => {
    await kvSet('session.expert', 'expert-token');
    await kvSet('session.staff', 'staff-token');
    const f = stubFetch(new Response('[]', { status: 200 }));
    render(<Credits />);
    await screen.findByText('Nothing has been published yet.');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]).toEqual(['/api/public/credits']);
  });
});
