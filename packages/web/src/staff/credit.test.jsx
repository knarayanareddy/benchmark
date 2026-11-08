import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicationStaff } from './PublicationStaff.jsx';
import { routes, fail } from '../test-helpers.js';

const ME = { id: 'mod2', role: 'moderator' };
const PAST = new Date(Date.now() - 3 * 3600e3).toISOString();
const FUTURE = new Date(Date.now() + 40 * 3600e3).toISOString();
const row = (over = {}) => ({ id: 'pub_1', status: 'consented', sourceKind: 'dissent', cardId: 'C1', country: 'TCD', proposer: 'mod1', reviewer: null, text: 'Shared text.', creditMode: 'uncredited', displayName: null, publishAfter: null, version: 2, ...over });

/** The table row for a publication, found by its text, so tests stay inside one row. */
const rowOf = (text) => screen.getByText(text).closest('tr');

function setup(rows, extra = {}) {
  const api = routes({ 'GET /api/staff/publications': rows, 'GET /api/staff/publications/offerable': [], ...extra });
  const utils = render(<PublicationStaff api={api} me={ME} />);
  return { api, ...utils };
}

describe('offer a contribution', () => {
  it('posts the chosen source kind and id, and says what happened', async () => {
    const { api } = setup([], { 'POST /api/staff/publications': {} });
    await userEvent.selectOptions(screen.getByLabelText('Source kind'), 'Discussion post');
    await userEvent.type(screen.getByLabelText('Source id'), 'post_9');
    await userEvent.click(screen.getByRole('button', { name: 'Offer for publication' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/staff/publications', { sourceKind: 'post', sourceId: 'post_9' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Offered.');
  });

  it('shows the server refusal, for example an anonymous author, in role=alert', async () => {
    setup([], { 'POST /api/staff/publications': fail(400, 'Anonymous contributions cannot be offered credit: their author cannot consent.') });
    await userEvent.type(screen.getByLabelText('Source id'), 'dis_1');
    await userEvent.click(screen.getByRole('button', { name: 'Offer for publication' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Anonymous contributions cannot be offered credit');
  });
});

describe('ready to offer', () => {
  const item = { sourceKind: 'post', sourceId: 'p_1', cardId: 'C1', statement: 'Cholera cases will exceed 10,000.', kind: 'evidence', label: 'Analyst 2703', text: 'Road cut by flooding.' };

  it('lists what can be offered and offers it with the right body, then refreshes', async () => {
    const offerable = [item];
    const { api } = setup([], { 'GET /api/staff/publications/offerable': () => offerable, 'POST /api/staff/publications': () => { offerable.length = 0; return {}; } });
    expect(await screen.findByText('Road cut by flooding.')).toBeInTheDocument();
    const ready = screen.getByText('Road cut by flooding.').closest('tr');
    await userEvent.click(within(ready).getByRole('button', { name: 'Offer for publication' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/staff/publications', { sourceKind: 'post', sourceId: 'p_1' }));
    expect(await screen.findByText('Nothing is waiting to be offered.')).toBeInTheDocument();
  });

  it('shows a refusal in role=alert and keeps the item', async () => {
    setup([], { 'GET /api/staff/publications/offerable': [item], 'POST /api/staff/publications': fail(409, 'this contribution has already been offered for credit') });
    const ready = (await screen.findByText('Road cut by flooding.')).closest('tr');
    await userEvent.click(within(ready).getByRole('button', { name: 'Offer for publication' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been offered');
    expect(screen.getByText('Road cut by flooding.')).toBeInTheDocument();
  });
});

describe('publications table', () => {
  it('shows each status as a pill, the text, and who is named only when a name is present', async () => {
    setup([
      row({ id: 'pub_a', status: 'published', text: 'Text A.', creditMode: 'credited', displayName: 'Ann Lee' }),
      row({ id: 'pub_b', status: 'proposed', text: 'Text B.' }),
    ]);
    expect(await screen.findByRole('table')).toHaveClass('stack');
    expect(screen.getByText('published', { selector: '.pill' })).toHaveClass('teal');
    expect(screen.getByText('proposed', { selector: '.pill' })).toBeInTheDocument();
    expect(rowOf('Text A.')).toHaveTextContent('Named: Ann Lee');
    expect(rowOf('Text B.')).toHaveTextContent('Uncredited');
    expect(rowOf('Text B.')).not.toHaveTextContent('Named:');
  });

  it('shows an empty state', async () => {
    setup([]);
    expect(await screen.findByText('No publications yet.')).toBeInTheDocument();
  });
});

describe('review of a consented publication', () => {
  it('approve is disabled until all three checklist items are ticked, then sends the checked flags', async () => {
    const { api } = setup([row()], { 'POST /api/staff/publications/pub_1/review': {} });
    const r = await screen.findByText('Shared text.').then((el) => el.closest('tr'));
    const approve = within(r).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    await userEvent.click(within(r).getByLabelText('No third parties are identifiable'));
    await userEvent.click(within(r).getByLabelText('No location detail that could identify someone'));
    expect(approve).toBeDisabled();
    await userEvent.click(within(r).getByLabelText('The author understands the risk'));
    expect(approve).toBeEnabled();
    await userEvent.click(approve);
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/staff/publications/pub_1/review', {
      approve: true, note: '', checked: { noThirdParties: true, noLocationDetail: true, riskUnderstood: true },
    }));
  });

  it('reject needs a note, and sends it with approve false', async () => {
    const { api } = setup([row()], { 'POST /api/staff/publications/pub_1/review': {} });
    const r = await screen.findByText('Shared text.').then((el) => el.closest('tr'));
    const reject = within(r).getByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    await userEvent.type(within(r).getByLabelText('Note (required to reject)'), 'Names a district.');
    expect(reject).toBeEnabled();
    await userEvent.click(reject);
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/staff/publications/pub_1/review', {
      approve: false, note: 'Names a district.', checked: { noThirdParties: false, noLocationDetail: false, riskUnderstood: false },
    }));
  });

  it('the proposer cannot review their own offer', async () => {
    setup([row({ proposer: ME.id })]);
    const r = await screen.findByText('Shared text.').then((el) => el.closest('tr'));
    expect(within(r).getByText('A different moderator must review this.')).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(r).queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(within(r).queryByRole('checkbox')).toBeNull();
  });

  it('a review the server refuses is shown in role=alert', async () => {
    setup([row()], { 'POST /api/staff/publications/pub_1/review': fail(409, 'A different moderator must review this.') });
    const r = await screen.findByText('Shared text.').then((el) => el.closest('tr'));
    await userEvent.click(within(r).getByLabelText('No third parties are identifiable'));
    await userEvent.click(within(r).getByLabelText('No location detail that could identify someone'));
    await userEvent.click(within(r).getByLabelText('The author understands the risk'));
    await userEvent.click(within(r).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A different moderator must review this.');
  });
});

describe('publish', () => {
  it('is enabled once publishAfter has passed, and posts to publish', async () => {
    const { api } = setup([row({ status: 'approved', publishAfter: PAST })], { 'POST /api/staff/publications/pub_1/publish': {} });
    const r = await screen.findByText('Shared text.').then((el) => el.closest('tr'));
    const publish = within(r).getByRole('button', { name: 'Publish' });
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/staff/publications/pub_1/publish'));
  });

  it('is disabled, with the date shown, until publishAfter has passed', async () => {
    const { api } = setup([row({ status: 'approved', publishAfter: FUTURE })]);
    const r = await screen.findByText('Shared text.').then((el) => el.closest('tr'));
    expect(within(r).getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(within(r).getByText(/Available after .*UTC/)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('POST', '/api/staff/publications/pub_1/publish');
  });
});
