import { useCallback, useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import { cachedBallot } from '../lib/device.js';
import { anonymous } from '../lib/send.js';
import { CardView } from './CardView.jsx';
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

/** One question with its reasons (labels only, never the numbers behind them) and the answer UI in place. */
function Entry({ api, mode, entry, onNext }) {
  // The chips already say why it matches; only the radar's own explanation ("older than a week", "beyond this week's cap") is new.
  const note = /\(([^)]+)\)\s*$/.exec(entry.reason ?? '')?.[1] ?? null;
  return (
    <article className="pulse-entry">
      {entry.why?.length > 0 && (
        <div className="pulse-why" aria-label="Why this is asked">
          {entry.why.map((/** @type {{ label: string }} */ w) => <span key={w.label} className="pill">{w.label}</span>)}
        </div>
      )}
      {note && <p className="muted">{note}</p>}
      <CardView api={api} card={entry.card} mode={mode} onNext={onNext} />
    </article>
  );
}

/** @param {{ api: import('../lib/api.js').Api, mode: 'server' | 'device', onExpired: () => void, onOpenQuestions: () => void, refreshKey?: number }} props */
export function Pulse({ api, mode, onExpired, onOpenQuestions, refreshKey = 0 }) {
  const [pulse, setPulse] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [radarOpen, setRadarOpen] = useState(false);
  const [reloads, setReloads] = useState(0);

  const fail = useCallback((/** @type {unknown} */ e) => {
    const err = asErr(e);
    if (err.status === 401) onExpired();
    else setError(err.offline ? 'You are offline. Try again when you are back online.' : err.message);
  }, [onExpired]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await api('GET', '/api/pulse');
        const [asks, radar] = await Promise.all([dropAnswered(p.asks), dropAnswered(p.radar)]);
        if (live) { setPulse({ ...p, asks, radar }); setError(''); }
      } catch (e) { if (live) fail(e); }
    })();
    return () => { live = false; };
  }, [api, fail, refreshKey, reloads]);

  const next = () => setReloads((n) => n + 1);

  const waiting = pulse?.waiting;
  const waitingTotal = waiting ? waiting.revise + waiting.discussion + waiting.offers : 0;
  const radarCount = pulse?.radar.length ?? 0;

  return (
    <>
      <h1 className="page-title">Your Pulse</h1>
      <p className="page-sub">
        {pulse
          ? `At most ${pulse.weeklyCap} new ${plural(pulse.weeklyCap, 'question', 'questions')} a week (you set that in My data). Nothing is urgent unless it says so.`
          : 'At most a few new questions a week (you set that in My data). Nothing is urgent unless it says so.'}
      </p>
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
          <section aria-labelledby="pulse-asks">
            <h2 id="pulse-asks">Asked of you this week</h2>
            {pulse.asks.length === 0 && (
              <p className="muted">{radarCount ? 'Nothing is pushed to you this week.' : 'Nothing new matches what you cover this week.'}</p>
            )}
            {pulse.asks.map((/** @type {any} */ e) => <Entry key={e.card.id} api={api} mode={mode} entry={e} onNext={next} />)}
          </section>
          {radarCount > 0 && (
            <section aria-labelledby="pulse-radar" className="pulse-radar">
              <h2 id="pulse-radar">On your radar, not pushed</h2>
              <p className="muted">You can answer these any time; they are just not pushed.</p>
              <button type="button" className="secondary" aria-expanded={radarOpen} aria-controls="pulse-radar-list" onClick={() => setRadarOpen(!radarOpen)}>
                {`${radarOpen ? 'Hide' : 'Show'} ${radarCount} ${plural(radarCount, 'question', 'questions')}`}
              </button>
              {radarOpen && (
                <div id="pulse-radar-list">
                  {pulse.radar.map((/** @type {any} */ e) => <Entry key={e.card.id} api={api} mode={mode} entry={e} onNext={next} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
