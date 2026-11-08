import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Thread } from './Thread.jsx';
import { routes, fail, blindServer, card, json } from '../test-helpers.js';
import { createSecret } from '../lib/device.js';

afterEach(() => { vi.unstubAllGlobals(); });

const POSTS = [
  { id: 'p1', kind: 'claim', parentId: null, label: 'Participant 1', text: 'Rainy season starts late this year.', day: '2026-11-03', own: false },
  { id: 'p2', kind: 'reply', parentId: 'p1', label: 'Pseudonym Heron', text: 'Agreed, the forecast says so too.', day: '2026-11-04', own: true },
  { id: 'p3', kind: 'evidence', parentId: null, label: 'Participant 2', text: 'The ministry bulletin lists two districts.', day: '2026-11-05', own: false },
];
const OPEN = { cardId: 'C1', statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.', canPost: true, kinds: ['claim', 'evidence', 'counter', 'question', 'missing_risk', 'reply'], posts: POSTS, mine: [] };

const open = (over = {}) => ({ ...OPEN, ...over });
/** Opens the discussion with a given server response. */
async function openWith(thread, extra = {}) {
  const a = routes({ 'POST /api/thread': () => thread, 'POST /api/thread/posts': () => ({ id: 'px', status: 'pending', warnings: [] }), ...extra });
  render(<Thread api={a} card={card()} mode="server" />);
  await userEvent.click(screen.getByRole('button', { name: 'Open the discussion' }));
  await screen.findByRole('button', { name: 'Close the discussion' });
  return a;
}
const textBox = () => screen.getByLabelText('Your post');
const kindBox = () => screen.getByLabelText('Kind');
const postBtn = () => screen.getByRole('button', { name: 'Post' });

describe('reading the discussion', () => {
  it('is collapsed by default and only asks the server when opened', () => {
    const a = routes({});
    render(<Thread api={a} card={card()} mode="server" />);
    expect(screen.getByRole('button', { name: 'Open the discussion' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Discussion')).toBeNull();
    expect(a).not.toHaveBeenCalled();
  });

  it('shows approved posts oldest first, replies under their parent, with kind, label, day and a You marker', async () => {
    await openWith(open());
    const first = screen.getByText('Rainy season starts late this year.').closest('li');
    const reply = screen.getByText('Agreed, the forecast says so too.').closest('li');
    expect(reply.parentElement).toHaveClass('thread-replies');
    expect(reply.parentElement.parentElement).toContainElement(first);
    expect(within(first).getByText('Claim')).toBeInTheDocument();
    expect(within(first).getByText('Participant 1')).toBeInTheDocument();
    expect(within(first).getByText('2026-11-03')).toBeInTheDocument();
    expect(within(reply).getByText('Reply')).toBeInTheDocument();
    expect(within(reply).getByText('You')).toBeInTheDocument();
    expect(within(first).queryByText('You')).toBeNull();
    const texts = screen.getAllByText(/Rainy|Agreed|ministry/).map((n) => n.textContent);
    expect(texts).toEqual(['Rainy season starts late this year.', 'Agreed, the forecast says so too.', 'The ministry bulletin lists two districts.']);
  });

  it('shows the person’s own pending and rejected posts, with the moderator’s note for rejected ones', async () => {
    await openWith(open({
      mine: [
        { id: 'm1', kind: 'question', text: 'Is the lab data public?', status: 'pending', note: null },
        { id: 'm2', kind: 'claim', text: 'Use the 2025 figures.', status: 'rejected', note: 'Names a district.' },
      ],
    }));
    const mine = screen.getByRole('region', { name: 'Your posts' });
    expect(within(mine).getByText('Waiting for a moderator')).toBeInTheDocument();
    expect(within(mine).getByText('Is the lab data public?')).toBeInTheDocument();
    expect(within(mine).getByText('Use the 2025 figures.')).toBeInTheDocument();
    expect(within(mine).getByText(/A moderator said: Names a district\./)).toBeInTheDocument();
  });

  it('says so when nothing is approved yet', async () => {
    await openWith(open({ posts: [] }));
    expect(screen.getByText('No posts have been approved yet.')).toBeInTheDocument();
  });

  it('shows a server refusal to open, instead of the discussion', async () => {
    const a = routes({ 'POST /api/thread': fail(409, 'you did not answer round 1') });
    render(<Thread api={a} card={card()} mode="server" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the discussion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('you did not answer round 1');
  });
});

describe('posting', () => {
  it('sends the post with the chosen kind and no parent, then shows the advice and clears the form', async () => {
    let posted = false;
    const a = routes({
      'POST /api/thread': () => open({ mine: posted ? [{ id: 'px', kind: 'evidence', text: 'Two districts.', status: 'pending', note: null }] : [] }),
      'POST /api/thread/posts': (b) => { posted = true; expect(b).toEqual({ cardId: 'C1', kind: 'evidence', text: 'Two districts.', parentId: null }); return { id: 'px', status: 'pending', warnings: [{ kind: 'place', match: 'Mongo' }] }; },
    });
    render(<Thread api={a} card={card()} mode="server" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the discussion' }));
    await screen.findByText('Rainy season starts late this year.');
    await userEvent.selectOptions(kindBox(), 'evidence');
    await userEvent.type(textBox(), 'Two districts.');
    await userEvent.click(postBtn());
    const status = await screen.findByText(/Possible identifying detail: Mongo/);
    expect(status.closest('[role="status"]')).toHaveClass('warn');
    expect(textBox()).toHaveValue('');
    expect(a).toHaveBeenCalledWith('POST', '/api/thread/posts', { cardId: 'C1', kind: 'evidence', text: 'Two districts.', parentId: null });
    expect(await screen.findByRole('region', { name: 'Your posts' })).toHaveTextContent('Waiting for a moderator');
  });

  it('shows the form only while posting is open, and says why it is closed otherwise', async () => {
    await openWith(open({ canPost: false }));
    expect(screen.queryByRole('form', { name: 'Post to the discussion' })).toBeNull();
    expect(screen.queryByLabelText('Your post')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.getByText('Posting is closed. You can still read the discussion.')).toBeInTheDocument();
  });

  it('shows the no-numbers reminder and the limit of 5 posts', async () => {
    await openWith(open());
    expect(screen.getByText(/No numbers: do not say how likely you think it is\. A moderator reads this before anyone else sees it\./)).toBeInTheDocument();
    expect(screen.getByText(/5 posts per question/)).toBeInTheDocument();
  });

  it('counts characters out of 600 as the person types', async () => {
    await openWith(open());
    expect(screen.getByText(/^0 of 600/)).toBeInTheDocument();
    await userEvent.type(textBox(), 'abc');
    expect(screen.getByText(/^3 of 600/)).toBeInTheDocument();
  });

  it.each([
    ['a percentage sign', '70% of the district is cut off', /Remove the number/],
    ['a digit followed by per cent', 'About 7 per cent of the camps', /Remove the number/],
  ])('blocks %s before anything is sent', async (_name, value, message) => {
    const a = await openWith(open());
    await userEvent.type(textBox(), value);
    await userEvent.click(postBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(a.mock.calls.filter((c) => c[1] === '/api/thread/posts')).toHaveLength(0);
  });

  it('refuses an empty post and one over 600 characters, without sending', async () => {
    const a = await openWith(open());
    await userEvent.click(postBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Write something first.');
    fireEvent.change(textBox(), { target: { value: 'x'.repeat(601) } });
    await userEvent.click(postBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('600 characters or fewer');
    expect(a.mock.calls.filter((c) => c[1] === '/api/thread/posts')).toHaveLength(0);
  });

  it('shows the server’s own refusal text when it rejects a post', async () => {
    await openWith(open(), { 'POST /api/thread/posts': fail(400, 'you have used your 5 posts for this question') });
    await userEvent.type(textBox(), 'One more point.');
    await userEvent.click(postBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('you have used your 5 posts for this question');
  });

  it('a reply sends the kind reply with the parent set, and can be cancelled', async () => {
    const a = await openWith(open(), { 'POST /api/thread/posts': () => ({ id: 'px', status: 'pending', warnings: [] }) });
    const replyButtons = screen.getAllByRole('button', { name: 'Reply' });
    expect(replyButtons).toHaveLength(2); // one per top-level approved post, none on the reply itself
    await userEvent.click(replyButtons[0]);
    expect(kindBox()).toBeDisabled();
    expect(kindBox()).toHaveValue('reply');
    await userEvent.type(textBox(), 'Fair point.');
    await userEvent.click(postBtn());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/thread/posts', { cardId: 'C1', kind: 'reply', text: 'Fair point.', parentId: 'p1' }));
  });

  it('cancelling a reply goes back to a normal post', async () => {
    const a = await openWith(open());
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(kindBox()).not.toBeDisabled();
    await userEvent.type(textBox(), 'Plain post.');
    await userEvent.click(postBtn());
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/thread/posts', { cardId: 'C1', kind: 'claim', text: 'Plain post.', parentId: null }));
  });
});

describe('device-held key', () => {
  it('opens and posts with the blind ballot and no login header, and never sends a respondent key', async () => {
    const srv = blindServer();
    await createSecret();
    const a = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ url, headers: init.headers, body });
      if (url === '/api/anon/thread') return json(open({ posts: [] }));
      if (url === '/api/anon/thread/posts') return json({ id: 'px', status: 'pending', warnings: [] });
      throw new Error(`unexpected ${url}`);
    }));
    render(<Thread api={a} card={card({ deviceHeld: true })} mode="device" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the discussion' }));
    await screen.findByText('No posts have been approved yet.');
    const opened = seen.find((s) => s.url === '/api/anon/thread');
    expect(opened.body).toMatchObject({ cardId: 'C1' });
    expect(srv.verify('C1', opened.body.token, opened.body.signature)).toBe(true);
    expect(Object.keys(opened.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    await userEvent.type(textBox(), 'A device-held point.');
    await userEvent.click(postBtn());
    await waitFor(() => expect(seen.some((s) => s.url === '/api/anon/thread/posts')).toBe(true));
    const sent = seen.find((s) => s.url === '/api/anon/thread/posts');
    expect(sent.body).toEqual({ cardId: 'C1', token: opened.body.token, signature: opened.body.signature, kind: 'claim', text: 'A device-held point.', parentId: null });
    expect(Object.keys(sent.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(a.mock.calls.map((c) => c[1])).toEqual(['/api/blind/key', '/api/blind/issue']);
  });

  it('a device with no key on it gets a clear message, not a crash', async () => {
    const a = routes({});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Thread api={a} card={card({ deviceHeld: true })} mode="device" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the discussion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This device does not hold your key');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
  });
});
