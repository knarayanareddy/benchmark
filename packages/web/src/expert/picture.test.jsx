import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardView, resetLevelCache } from './CardView.jsx';
import { Picture } from './Picture.jsx';
import { routes, card } from '../test-helpers.js';

const RELEASE = { suppressed: false, n: 6, estimate: 0.55, lo: 0.4, hi: 0.7 };
const REV = (over = {}) => card({ round: 2, yourEstimate: 0.3, release: RELEASE, acaps: { p: 70 }, ...over });
const slider = () => screen.getByRole('slider', { name: /probability/i });
const save = () => screen.getByRole('button', { name: 'Save my revision' });
const keep = () => screen.getByRole('button', { name: 'Keep my first answer' });
const left = (el) => el.style.left;

afterEach(() => { vi.unstubAllGlobals(); resetLevelCache(); });

describe('the picture: geometry', () => {
  it('places the band, the pooled mark, ACAPS, your estimate and the revision from the data', () => {
    const { container } = render(<Picture acaps={{ p: 70 }} release={RELEASE} mine={0.3} revised={40} />);
    const band = container.querySelector('.picture-band');
    expect(left(band)).toBe('40%');
    expect(band.style.width).toBe('30%');
    expect(left(container.querySelector('.picture-mark'))).toBe('55%');
    expect(left(container.querySelector('.picture-acaps'))).toBe('70%');
    expect(left(container.querySelector('.picture-you'))).toBe('30%');
    expect(left(container.querySelector('.picture-revised'))).toBe('40%');
  });

  it('keeps the band at least 2% wide, even for a near-point interval', () => {
    const { container } = render(<Picture acaps={null} release={{ ...RELEASE, lo: 0.5, hi: 0.501 }} mine={null} revised={null} />);
    expect(container.querySelector('.picture-band').style.width).toBe('2%');
  });

  it('draws no ACAPS marker when the card has no rating, and says so in its tile', () => {
    const { container } = render(<Picture acaps={null} release={RELEASE} mine={0.3} revised={null} />);
    expect(container.querySelector('.picture-acaps')).toBeNull();
    expect(screen.getByText('Unrated risk.')).toBeInTheDocument();
  });

  it('shows no circle numbers and the not-published text when the release is suppressed', () => {
    const { container } = render(<Picture acaps={null} release={{ suppressed: true }} mine={null} revised={null} />);
    expect(screen.getByText('The circle result is not published yet.')).toBeInTheDocument();
    expect(container.querySelector('.picture-band')).toBeNull();
    expect(container.querySelector('.picture-mark')).toBeNull();
    expect(container.querySelector('.picture-card')).toHaveTextContent(/^The picture/);
    expect(container.querySelector('.picture-tiles').textContent).not.toMatch(/\d/);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Probability bar from 0 to 100 percent. The circle result is not published yet.');
  });
});

describe('the picture: Round 1 and the revision', () => {
  it('never renders a picture for a Round-1 card, even one carrying an ACAPS reading', () => {
    const { container } = render(<CardView api={routes({})} card={card({ acaps: { p: 70 }, release: RELEASE })} mode="server" onNext={() => {}} />);
    expect(container.querySelector('.picture-card')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('a Round-1 payload is not shown as a picture even if it is opened as a revision', () => {
    const { container } = render(<CardView api={routes({})} card={card({ round: 1, yourEstimate: 0.3, acaps: { p: 70 }, release: RELEASE })} mode="server" revise onNext={() => {}} />);
    expect(container.querySelector('.picture-card')).toBeNull();
  });

  it('shows the revised marker only after a revision is saved, and not after keeping the first answer', async () => {
    const a = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, round: 2, p: b.p }) });
    const { container, unmount } = render(<CardView api={a} card={REV()} mode="server" revise onNext={() => {}} />);
    expect(container.querySelector('.picture-revised')).toBeNull();
    await userEvent.click(keep());
    expect(await screen.findByText(/Saved: 30%/)).toBeInTheDocument();
    expect(container.querySelector('.picture-revised')).toBeNull();
    unmount();

    const b = routes({ 'POST /api/estimates': (x) => ({ cardId: x.cardId, round: 2, p: x.p }) });
    const second = render(<CardView api={b} card={REV()} mode="server" revise onNext={() => {}} />);
    fireEvent.change(slider(), { target: { value: '45' } });
    await userEvent.click(save());
    expect(await screen.findByText(/Saved: 45%/)).toBeInTheDocument();
    await waitFor(() => expect(second.container.querySelector('.picture-revised')).toHaveTextContent('revised 45%'));
    expect(second.container.querySelector('.picture-revised')).toHaveStyle({ left: '45%' });
    expect(screen.getByText(/Your locked first estimate/)).toHaveTextContent('Your locked first estimate: 30% · revised to 45%');
  });
});

describe('the picture: accessibility', () => {
  it('the bar is an image whose label states every number in words', () => {
    render(<Picture acaps={{ p: 70 }} release={RELEASE} mine={0.3} revised={40} />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveAttribute('aria-label', 'Probability bar from 0 to 100 percent. ACAPS rating 70 percent. Circle pooled estimate 55 percent, circle range 40 to 70 percent. Your first estimate 30 percent. Revised estimate 40 percent.');
  });

  it('the same numbers are written out as visible text, so no meaning rests on colour', () => {
    render(<Picture acaps={{ p: 70 }} release={RELEASE} mine={0.3} revised={40} />);
    expect(screen.getByText('Circle range 40–70% · n=6')).toBeInTheDocument();
    expect(screen.getByText('~70%')).toBeInTheDocument();
    expect(screen.getByText(/Your locked first estimate/)).toHaveTextContent('Your locked first estimate: 30% · revised to 40%');
  });

  it('no longer calls the band an 80% interval or the circle performance-weighted', () => {
    const { container } = render(<Picture acaps={{ p: 70 }} release={RELEASE} mine={0.3} revised={null} />);
    expect(container.textContent).not.toMatch(/performance-weighted|80% of views|80% interval/);
    expect(container.querySelector('.picture-band').getAttribute('title')).toBe('Circle range 40–70%');
  });
});
