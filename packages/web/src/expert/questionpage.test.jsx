import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionPage, closesOn } from './QuestionPage.jsx';
import { routes, card } from '../test-helpers.js';

const entry = (over = {}) => ({ card: card({ id: 'C1', theme: 'conflict', window: { from: '2026-11-01', to: '2027-04-30' } }), why: [{ label: 'Covers Chad' }], reason: 'Covers Chad', ...over });
const PROFILE = { 'GET /api/me/profile': { level: 'pseudonymous' } };

describe('the question page frame', () => {
  it('shows the breadcrumb: back to Pulse, the country, the theme, the kind, and when it closes', () => {
    render(<QuestionPage api={routes(PROFILE)} entry={entry()} mode="server" onBack={() => {}} onNext={() => {}} />);
    const back = screen.getByRole('button', { name: '← Pulse' });
    const crumbs = back.parentElement;
    expect(crumbs).toHaveClass('question-crumbs');
    expect(crumbs.querySelector('.pill.teal')).toHaveTextContent('Chad');
    expect(crumbs.querySelectorAll('.pill')[1]).toHaveTextContent('Conflict & security');
    expect(crumbs.querySelector('.pill.indigo')).toHaveTextContent('Risk question');
    expect(crumbs).toHaveTextContent('closes 30 Apr 2027');
  });

  it('leaves out the closing date when the card has no window', () => {
    render(<QuestionPage api={routes(PROFILE)} entry={entry({ card: card({ window: undefined }) })} mode="server" onBack={() => {}} onNext={() => {}} />);
    expect(screen.queryByText(/closes/)).toBeNull();
  });

  it('puts the existing answer card in place, under the breadcrumb', () => {
    const { container } = render(<QuestionPage api={routes(PROFILE)} entry={entry()} mode="server" onBack={() => {}} onNext={() => {}} />);
    expect(container.querySelector('.question-crumbs + .card.question')).not.toBeNull();
    expect(screen.getByRole('slider', { name: /probability/i })).toBeInTheDocument();
  });

  it('the breadcrumb back button calls onBack', async () => {
    const back = vi.fn();
    render(<QuestionPage api={routes(PROFILE)} entry={entry()} mode="server" onBack={back} onNext={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '← Pulse' }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('answering posts the estimate, and Next question calls onNext', async () => {
    const next = vi.fn();
    const a = routes({ ...PROFILE, 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 1, p: b.p, clamped: false }) });
    render(<QuestionPage api={a} entry={entry()} mode="server" onBack={() => {}} onNext={next} />);
    fireEvent.change(screen.getByRole('slider', { name: /probability/i }), { target: { value: '40' } });
    await userEvent.click(screen.getByRole('button', { name: 'Lock in my estimate' }));
    await waitFor(() => expect(a).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.4 }));
    expect(await screen.findByText(/Saved: 40%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('closesOn', () => {
  it('reads the window end as a day, in words', () => {
    expect(closesOn(card({ window: { from: '2026-11-01', to: '2027-05-09' } }))).toBe('9 May 2027');
  });

  it('is null without a window', () => {
    expect(closesOn(card({ window: undefined }))).toBeNull();
  });
});
