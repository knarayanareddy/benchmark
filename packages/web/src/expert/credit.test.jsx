import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Offers } from './Offers.jsx';
import { routes, fail } from '../test-helpers.js';

const base = { id: 'pub_1', cardStatement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.', originalText: 'Original text.', text: 'Original text.', credit: null, sensitive: false, note: null, publishAfter: null };
const proposed = (over = {}) => ({ ...base, status: 'proposed', ...over });

/** Renders one offer and returns the api mock and the onChange spy. */
function setup(item, handlers = {}) {
  const api = routes({ [`POST /api/publications/${item.id}/respond`]: handlers.respond ?? {}, [`POST /api/publications/${item.id}/withdraw`]: handlers.withdraw ?? {} });
  const onChange = vi.fn();
  render(<Offers api={api} items={[item]} onChange={onChange} />);
  return { api, onChange };
}

describe('offer card: proposed', () => {
  it('explains the decision in plain words and shows the text to edit', () => {
    setup(proposed());
    expect(screen.getByRole('heading', { name: 'A contribution of yours could be published' })).toBeInTheDocument();
    expect(screen.getByText(base.cardStatement)).toBeInTheDocument();
    expect(screen.getByText(/It is your decision/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is published without your yes/)).toBeInTheDocument();
    expect(screen.getByText(/second moderator checks it for safety/)).toBeInTheDocument();
    expect(screen.getByText(/48-hour wait/)).toBeInTheDocument();
    expect(screen.getByText(/Copies that others have already taken cannot be recalled/)).toBeInTheDocument();
    expect(screen.getByLabelText('The text to publish. You can change it.')).toHaveValue('Original text.');
  });

  it('offers three clearly labelled choices and no name fields until "with my name" is chosen', async () => {
    setup(proposed());
    expect(screen.getByRole('radio', { name: 'Do not publish' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Publish without my name' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Publish with my name' })).not.toBeChecked();
    expect(screen.queryByLabelText(/Display name/)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Publish with my name' }));
    expect(screen.getByLabelText(/Display name \(2 to 80 characters\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Organisation/)).toBeInTheDocument();
  });

  it('keeps the submit button disabled until a choice is valid', async () => {
    setup(proposed());
    const send = screen.getByRole('button', { name: 'Send my choice' });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Publish with my name' }));
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Display name/), 'A');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Display name/), 'B');
    expect(send).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Do not publish' }));
    expect(send).toBeEnabled();
  });

  it('sends the decline body and calls onChange', async () => {
    const { api, onChange } = setup(proposed(), { respond: {} });
    await userEvent.click(screen.getByRole('radio', { name: 'Do not publish' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send my choice' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/publications/pub_1/respond', { decision: 'decline', text: 'Original text.', acknowledgedRisk: false });
  });

  it('sends the uncredited body with the edited text', async () => {
    const { api, onChange } = setup(proposed(), { respond: {} });
    await userEvent.click(screen.getByRole('radio', { name: 'Publish without my name' }));
    const text = screen.getByLabelText('The text to publish. You can change it.');
    await userEvent.clear(text);
    await userEvent.type(text, 'Edited by me.');
    await userEvent.click(screen.getByRole('button', { name: 'Send my choice' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/publications/pub_1/respond', { decision: 'uncredited', text: 'Edited by me.', acknowledgedRisk: false });
  });

  it('sends the credited body with name and organisation', async () => {
    const { api, onChange } = setup(proposed(), { respond: {} });
    await userEvent.click(screen.getByRole('radio', { name: 'Publish with my name' }));
    await userEvent.type(screen.getByLabelText(/Display name/), 'Ann Lee');
    await userEvent.type(screen.getByLabelText(/Organisation/), 'Clinic Co');
    await userEvent.click(screen.getByRole('button', { name: 'Send my choice' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/publications/pub_1/respond', { decision: 'credited', text: 'Original text.', displayName: 'Ann Lee', organisation: 'Clinic Co', acknowledgedRisk: false });
  });

  it('for a sensitive card, naming shows the risk and needs the acknowledgement before it can be sent', async () => {
    const { api, onChange } = setup(proposed({ sensitive: true }), { respond: {} });
    await userEvent.click(screen.getByRole('radio', { name: 'Publish with my name' }));
    expect(screen.getByText(/sensitive context/)).toHaveClass('amber');
    await userEvent.type(screen.getByLabelText(/Display name/), 'Ann Lee');
    const send = screen.getByRole('button', { name: 'Send my choice' });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I understand the risk of being named'));
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/publications/pub_1/respond', { decision: 'credited', text: 'Original text.', displayName: 'Ann Lee', acknowledgedRisk: true });
  });

  it('for a sensitive card, publishing without a name needs no risk acknowledgement', async () => {
    setup(proposed({ sensitive: true }));
    await userEvent.click(screen.getByRole('radio', { name: 'Publish without my name' }));
    expect(screen.getByRole('button', { name: 'Send my choice' })).toBeEnabled();
    expect(screen.queryByLabelText('I understand the risk of being named')).toBeNull();
  });

  it('shows the server error in role=alert and does not call onChange', async () => {
    const { onChange } = setup(proposed(), { respond: fail(400, 'The text names a person or place. Remove it, or choose to be named.') });
    await userEvent.click(screen.getByRole('radio', { name: 'Publish without my name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send my choice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The text names a person or place');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('withdraw needs a confirmation step before anything is sent', async () => {
    const { api, onChange } = setup(proposed(), { withdraw: {} });
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(api).not.toHaveBeenCalledWith('POST', '/api/publications/pub_1/withdraw');
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('POST', '/api/publications/pub_1/withdraw');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, withdraw it' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/publications/pub_1/withdraw');
  });
});

describe('offer card: other statuses', () => {
  it('consented: read-only summary, waiting line, and withdraw', async () => {
    const { api, onChange } = setup({ ...base, status: 'consented', text: 'Shared text.', credit: { mode: 'credited', displayName: 'Ann Lee', organisation: 'Clinic Co' } }, { withdraw: {} });
    expect(screen.getByText('Shared text.')).toBeInTheDocument();
    expect(screen.getByText('Published with your name: Ann Lee, Clinic Co.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for a safety check')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, withdraw it' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith('POST', '/api/publications/pub_1/withdraw');
  });

  it('approved with a publish date in the future: says when it can be published', () => {
    const when = new Date(Date.UTC(2030, 0, 2, 9, 30));
    setup({ ...base, status: 'approved', credit: { mode: 'uncredited' }, publishAfter: when.toISOString() });
    expect(screen.getByText(/Approved; it can be published after .*2030.*UTC/)).toBeInTheDocument();
    expect(screen.getByText('Published without your name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('published: shows the text, the credit line, the copies note and withdraw', () => {
    setup({ ...base, status: 'published', text: 'Published text.', credit: { mode: 'uncredited' } });
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Published text.')).toBeInTheDocument();
    expect(screen.getByText('Published without your name.')).toBeInTheDocument();
    expect(screen.getByText(/Copies that others have already taken cannot be recalled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('rejected: says not published and shows the moderator note', () => {
    setup({ ...base, status: 'rejected', note: 'The checklist was not complete.' });
    expect(screen.getByText('Not published')).toBeInTheDocument();
    expect(screen.getByText("Moderator's note: The checklist was not complete.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });
});
