import { describe, it, expect } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Discussion } from './Discussion.jsx';
import { routes, fail } from '../test-helpers.js';

const CARDS = [
  { id: 'C1', statement: 'Cholera cases in Chad will exceed 10,000.', status: 'closed', round: 1, threadEnabled: false },
  { id: 'C2', statement: 'Floods in Sudan will displace 50,000.', status: 'closed', round: 2, threadEnabled: true },
];
const PENDING = [
  { id: 'p_1', cardId: 'C1', statement: 'Cholera cases in Chad will exceed 10,000.', kind: 'claim', parentId: null, label: 'Participant 1', text: 'The Mongo clinic reports it daily.', hints: [{ kind: 'place', match: 'Mongo' }], day: '2026-11-03' },
  { id: 'p_2', cardId: 'C1', statement: 'Cholera cases in Chad will exceed 10,000.', kind: 'question', parentId: null, label: 'Participant 2', text: 'Who counts the cases?', hints: [], day: '2026-11-04' },
];

/** The table rows for one card in the Threads table. */
const cardRow = async (id) => (await screen.findByText(id, { selector: 'strong' })).closest('tr');
const postRow = (text) => screen.getByText(text).closest('tr');

describe('threads', () => {
  it('lists every card with its state and thread, and only offers the toggle for round 1', async () => {
    const a = routes({ 'GET /api/staff/cards': CARDS, 'GET /api/staff/thread/pending': [] });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    expect(await within(await cardRow('C1')).findByRole('button', { name: 'Enable thread for C1' })).toBeInTheDocument();
    expect(within(await cardRow('C1')).getByText('No thread')).toBeInTheDocument();
    expect(within(await cardRow('C2')).queryByRole('button')).toBeNull();
    expect(within(await cardRow('C2')).getByText('Only round 1 cards can change this.')).toBeInTheDocument();
    expect(within(await cardRow('C2')).getByText('Thread on')).toBeInTheDocument();
  });

  it('enables and disables a round 1 thread with the right body, then reloads', async () => {
    let enabled = false;
    const a = routes({
      'GET /api/staff/cards': () => [{ ...CARDS[0], threadEnabled: enabled }, CARDS[1]],
      'GET /api/staff/thread/pending': [],
      'PUT /api/staff/cards/C1/thread': (b) => { expect(b).toEqual({ enabled: true }); enabled = true; return { cardId: 'C1', enabled: true }; },
    });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    await userEvent.click(await within(await cardRow('C1')).findByRole('button', { name: 'Enable thread for C1' }));
    expect(await screen.findByText('Thread enabled for C1.')).toBeInTheDocument();
    expect(await within(await cardRow('C1')).findByRole('button', { name: 'Disable thread for C1' })).toBeInTheDocument();
    expect(a).toHaveBeenCalledWith('PUT', '/api/staff/cards/C1/thread', { enabled: true });
  });

  it('shows the server’s refusal of a toggle', async () => {
    const a = routes({
      'GET /api/staff/cards': CARDS,
      'GET /api/staff/thread/pending': [],
      'PUT /api/staff/cards/C1/thread': fail(409, 'round 2 has opened: the thread is closed'),
    });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    await userEvent.click(await within(await cardRow('C1')).findByRole('button', { name: 'Enable thread for C1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('round 2 has opened: the thread is closed');
  });

  it('shows an empty table as "No cards yet."', async () => {
    const a = routes({ 'GET /api/staff/cards': [], 'GET /api/staff/thread/pending': [] });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    expect(await screen.findByText('No cards yet.')).toBeInTheDocument();
  });
});

describe('posts waiting', () => {
  const load = (pending = PENDING) => routes({ 'GET /api/staff/cards': CARDS, 'GET /api/staff/thread/pending': pending });

  it('explains that round 2 waits for the queue', async () => {
    render(<Discussion api={load()} me={{ id: 'mod1', role: 'moderator' }} />);
    expect(await screen.findByText(/Round 2 cannot open while posts are waiting for you/)).toBeInTheDocument();
  });

  it('shows each post with its kind, label, day, text and the identifying hints as a warning', async () => {
    render(<Discussion api={load()} me={{ id: 'mod1', role: 'moderator' }} />);
    const row = (await screen.findByText('The Mongo clinic reports it daily.')).closest('tr');
    expect(within(row).getByText('Claim')).toBeInTheDocument();
    expect(within(row).getByText('Participant 1')).toBeInTheDocument();
    expect(within(row).getByText('2026-11-03')).toBeInTheDocument();
    expect(within(row).getByText('Possible identifying detail: Mongo')).toHaveClass('warn');
    expect(postRow('Who counts the cases?').textContent).not.toContain('Possible identifying detail');
  });

  it('approves with exactly { approve: true } and reloads the queue', async () => {
    let queue = PENDING;
    const a = routes({
      'GET /api/staff/cards': CARDS,
      'GET /api/staff/thread/pending': () => queue,
      'POST /api/staff/thread/posts/p_2/moderate': (b) => { expect(b).toEqual({ approve: true }); queue = [PENDING[0]]; return { id: 'p_2', status: 'approved' }; },
    });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    await userEvent.click(within(await waitForRow('Who counts the cases?')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByText('Who counts the cases?')).toBeNull());
    expect(a).toHaveBeenCalledWith('POST', '/api/staff/thread/posts/p_2/moderate', { approve: true });
  });

  it('rejects only with a note, sending the trimmed note', async () => {
    const a = routes({
      'GET /api/staff/cards': CARDS,
      'GET /api/staff/thread/pending': PENDING,
      'POST /api/staff/thread/posts/p_1/moderate': (b) => { expect(b).toEqual({ approve: false, note: 'Names the clinic.' }); return { id: 'p_1', status: 'rejected' }; },
    });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    const row = await waitForRow('The Mongo clinic reports it daily.');
    const reject = within(row).getByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    await userEvent.type(within(row).getByLabelText(/Reason for rejecting/), '   ');
    expect(reject).toBeDisabled();
    await userEvent.clear(within(row).getByLabelText(/Reason for rejecting/));
    await userEvent.type(within(row).getByLabelText(/Reason for rejecting/), '  Names the clinic.  ');
    expect(reject).toBeEnabled();
    await userEvent.click(reject);
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/staff/thread/posts/p_1/moderate', { approve: false, note: 'Names the clinic.' }));
  });

  it('refuses a note over 300 characters', async () => {
    render(<Discussion api={load()} me={{ id: 'mod1', role: 'moderator' }} />);
    const row = await waitForRow('The Mongo clinic reports it daily.');
    await userEvent.type(within(row).getByLabelText(/Reason for rejecting/), 'x'.repeat(301));
    expect(within(row).getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('shows the server’s refusal of a moderation', async () => {
    const a = routes({
      'GET /api/staff/cards': CARDS,
      'GET /api/staff/thread/pending': PENDING,
      'POST /api/staff/thread/posts/p_2/moderate': fail(409, 'this post was already moderated'),
    });
    render(<Discussion api={a} me={{ id: 'mod1', role: 'moderator' }} />);
    await userEvent.click(within(await waitForRow('Who counts the cases?')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('this post was already moderated');
  });

  it('shows an empty state when nothing is waiting', async () => {
    render(<Discussion api={load([])} me={{ id: 'mod1', role: 'moderator' }} />);
    expect(await screen.findByText('No posts are waiting for you.')).toBeInTheDocument();
  });
});

/** Waits for a pending post to appear, then returns its row. */
async function waitForRow(text) {
  await screen.findByText(text);
  return postRow(text);
}
