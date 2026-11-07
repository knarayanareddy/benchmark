import { useCallback, useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import { cachedBallot } from '../lib/device.js';
import { anonymous } from '../lib/send.js';
import { countryName } from '@benchmark/core/onboarding';
import { SideCards } from './SideCards.jsx';
import { closesOn } from './QuestionPage.jsx';
import '../pulse.css';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** Counts in words for the waiting strip; larger numbers stay digits. @param {number} n */
const word = (n) => (n < WORDS.length ? WORDS[n] : String(n));
/** @template T @param {number} n @param {T} one @param {T} many */
const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * A device-held entry is hidden once this device has answered it. The server cannot know that, so the
 * device asks, exactly as the inbox does. Entries without a cached ballot stay visible.
 * @param {any[]} entries
 */
async function dropAnswered(entries) {
  const open = [];
  for (const e of entries) {
    if (e.deviceHeld) {
      const have = await cachedBallot(e.card.id);
      if (have) {
        try { if ((await anonymous('POST', '/api/anon/status', { cardId: e.card.id, ...have })).round1 != null) continue; } catch { /* keep it visible */ }
      }
    }
    open.push(e);
  }
  return open;
}

/** @param {{ revise: number, discussion: number, offers: number }} w */
function waitingWords(w) {
  const parts = [];
  if (w.revise) parts.push(`${word(w.revise)} ${plural(w.revise, 'question', 'questions')} to revise`);
  if (w.discussion) parts.push(`${word(w.discussion)} ${plural(w.discussion, 'discussion', 'discussions')}`);
  if (w.offers) parts.push(`${word(w.offers)} publication ${plural(w.offers, 'offer', 'offers')}`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The labels that say why, never a number behind them. @param {{ why?: { label: string }[] }} entry */
const reasonsOf = (entry) => (entry.why ?? []).map((w) => w.label).join(' · ');

/** @param {{ entry: any, onOpen: (entry: any) => void }} props */
function Ask({ entry, onOpen }) {
  const { card } = entry;
  const closes = closesOn(card);
  return (
    <article className="card pulse-ask">
      <div className="pills">
        <span className="pill teal">Asked of you</span>
        {card.country && <span className="pill">{countryName(card.country)}</span>}
        {closes && <span className="pulse-when">closes {closes}</span>}
      </div>
      <h3>{card.statement}</h3>
      <div className="pulse-reasons"><b>Why you&apos;re seeing this:</b> {reasonsOf(entry)}</div>
      <button type="button" className="pulse-answer" onClick={() => onOpen(entry)}>Answer in ~90 seconds →</button>
    </article>
  );
}

/** @param {{ api: import('../lib/api.js').Api, mode: 'server' | 'device', onExpired: () => void, onOpenQuestions: () => void, onOpenData: () => void, onOpen: (entry: any) => void, onCount?: (n: number) => void, refreshKey?: number }} props */
export function Pulse({ api, mode, onExpired, onOpenQuestions, onOpenData, onOpen, onCount, refreshKey = 0 }) {
  const [pulse, setPulse] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [name, setName] = useState(/** @type {string | null} */ (null));

  const fail = useCallback((/** @type {unknown} */ e) => {
    const err = asErr(e);
    onCount?.(0);
    if (err.status === 401) onExpired();
    else setError(err.offline ? 'You are offline. Try again when you are back online.' : err.message);
  }, [onExpired, onCount]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await api('GET', '/api/pulse');
        const [asks, radar] = await Promise.all([dropAnswered(p.asks), dropAnswered(p.radar)]);
        if (live) { setPulse({ ...p, asks, radar }); setError(''); onCount?.(asks.length); }
      } catch (e) { if (live) fail(e); }
    })();
    return () => { live = false; };
  }, [api, fail, refreshKey, onCount]);

  // The name is shown only when the person chose to be identified. A device-held key is never named.
  useEffect(() => {
    if (mode === 'device') return undefined;
    let live = true;
    api('GET', '/api/me/profile')
      .then((/** @type {any} */ p) => { if (live && p?.level === 'identified' && p.name) setName(p.name); })
      .catch(() => { /* the greeting falls back to "Hello." */ });
    return () => { live = false; };
  }, [api, mode]);

  const waiting = pulse?.waiting;
  const waitingTotal = waiting ? waiting.revise + waiting.discussion + waiting.offers : 0;

  return (
    <div className="pulse-page">
      <div className="pulse-grid">
        <div className="pulse-main">
          <div className="pulse-head">
            <h1 className="page-title">Your Pulse</h1>
            {pulse && (
              <p className="page-sub">
                {`Hello${name ? ` ${name}` : ''}. We only ask when your declared expertise matches — ${pulse.weeklyCap}/week at most. Nothing here is urgent unless it says so.`}
              </p>
            )}
          </div>
          {error && <div className="msg err" role="alert">{error}</div>}
          {!pulse && !error && <p>Loading…</p>}
          {pulse && (
            <>
              {waitingTotal > 0 && (
                <div className="callout pulse-waiting">
                  <span>Also waiting for you: {waitingWords(waiting)}.</span>
                  <button type="button" className="secondary link" onClick={onOpenQuestions}>Go to Questions</button>
                </div>
              )}
              <section aria-labelledby="pulse-asks" className="pulse-section">
                {pulse.asks.length === 0 && (
                  <div className="card pulse-caught">
                    <div className="pulse-caught-title">You&apos;re all caught up ✓</div>
                    <p className="pulse-side-text">No new asks this week. That&apos;s the system respecting your time — new questions in your domain appear here as they match what you cover.</p>
                  </div>
                )}
                {pulse.asks.map((/** @type {any} */ e) => <Ask key={e.card.id} entry={e} onOpen={onOpen} />)}
              </section>
              <section aria-labelledby="pulse-radar" className="pulse-section">
                <h2 id="pulse-radar">On your radar — not pushed</h2>
                <p className="muted">In your domain, but we held them back (weekly cap or already enough views). Pull if you feel like it.</p>
                {pulse.radar.length === 0 && <p className="muted">Nothing waiting.</p>}
                {pulse.radar.map((/** @type {any} */ e) => (
                  <button key={e.card.id} type="button" className="pulse-radar-item" onClick={() => onOpen(e)}>
                    <b>{countryName(e.card.country)}</b> — {e.card.statement}
                    <span className="pulse-when-block">{reasonsOf(e)}</span>
                  </button>
                ))}
                <details className="pulse-transparency">
                  <summary>Transparency: why these are not pushed</summary>
                  <p>A question is held back when it is older than a week or beyond this week&apos;s cap.</p>
                </details>
              </section>
            </>
          )}
        </div>
        {pulse && <SideCards circle={pulse.circle} record={pulse.record} onOpenData={onOpenData} />}
      </div>
    </div>
  );
}
