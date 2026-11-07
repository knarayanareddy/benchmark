import { useCallback, useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import { cachedBallot } from '../lib/device.js';
import { anonymous } from '../lib/send.js';
import { CardView } from './CardView.jsx';

/** @param {{ api: import('../lib/api.js').Api, mode: 'server' | 'device', onExpired: () => void, refreshKey?: number }} props */
export function Inbox({ api, mode, onExpired, refreshKey = 0 }) {
  const [box, setBox] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');

  /** Fetch the inbox and, for a device-held key, hide what this device has already answered. */
  const fetchBox = useCallback(async () => {
    const b = await api('GET', '/api/inbox');
    if (b.deviceMode) {
      // The server cannot know what this device answered. Where a ballot is cached, ask; hide what is done.
      const open = [];
      for (const c of b.toAnswer) {
        const have = await cachedBallot(c.id);
        if (have) {
          try { if ((await anonymous('POST', '/api/anon/status', { cardId: c.id, ...have })).round1 != null) continue; } catch { /* keep it visible */ }
        }
        open.push(c);
      }
      b.toAnswer = open;
    }
    return b;
  }, [api]);

  const fail = useCallback((e) => {
    const err = asErr(e);
    if (err.status === 401) onExpired(); else setError(err.offline ? 'You are offline. Questions you opened before are still here.' : err.message);
  }, [onExpired]);

  const load = useCallback(async () => {
    try { setBox(await fetchBox()); setError(''); } catch (e) { fail(e); }
  }, [fetchBox, fail]);

  useEffect(() => {
    let live = true;
    (async () => {
      try { const b = await fetchBox(); if (live) { setBox(b); setError(''); } } catch (e) { if (live) fail(e); }
    })();
    return () => { live = false; };
  }, [fetchBox, fail, refreshKey]);

  if (error && !box) return <div className="msg warn" role="status">{error}</div>;
  if (!box) return <p>Loading…</p>;
  const ack = async (id) => { await api('DELETE', `/api/me/notices/${encodeURIComponent(id)}`); load(); };
  return (
    <>
      <h1 className="page-title">Your questions</h1>
      <p className="page-sub">Each one takes about a minute and a half. Answer from your own knowledge first; there is no right way to feel about a number.</p>
      {error && <div className="msg warn" role="status">{error}</div>}
      {box.notices?.length > 0 && (
        <section aria-label="Notices">
          <h2>Something you should know</h2>
          {box.notices.map((n) => (
            <div key={n.id} className="msg warn">{n.text}
              <div className="row"><button type="button" className="secondary" onClick={() => ack(n.id)}>I have read this</button></div>
            </div>
          ))}
        </section>
      )}
      {box.notifications.length > 0 && (
        <section><h2>What changed because of you</h2>{box.notifications.map((n, i) => <p key={i}>{n.body}</p>)}</section>
      )}
      {box.openForRevision.length > 0 && (
        <>
          <h2>Open for revision</h2>
          {box.openForRevision.map((c) => <CardView key={c.id} api={api} card={c} mode={mode} revise onNext={load} />)}
        </>
      )}
      <h2>New questions</h2>
      {box.toAnswer.length
        ? box.toAnswer.map((c) => <CardView key={c.id} api={api} card={c} mode={mode} onNext={load} />)
        : <p className="muted">Nothing new for you right now. Come back later.</p>}
    </>
  );
}
