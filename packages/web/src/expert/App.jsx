import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi } from '../lib/api.js';
import { kvGet, kvSet, kvDel } from '../lib/kv.js';
import { flush, pending } from '../lib/queue.js';
import { sendEstimate } from '../lib/send.js';
import { setSecret, hasDeviceSecret } from '../lib/device.js';
import { decodeRecovery } from '../lib/recovery.js';
import { Onboard } from './Onboard.jsx';
import { Inbox } from './Inbox.jsx';
import { MyData } from './MyData.jsx';

const TOKEN = 'session.expert';
const MODE = 'session.mode';

export function readInvite() {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite');
}

function Landing({ onRestored }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  async function restore() {
    try { await setSecret(decodeRecovery(code)); setMsg({ kind: 'ok', text: 'Key restored on this device. Now open your personal link to sign in.' }); onRestored?.(); }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
  }
  return (
    <section>
      <h2>Ground Truth</h2>
      <p>This is an invitation-only panel. Open the personal link you were sent to take part. If your link has expired, ask your coordinator for a new one.</p>
      <details>
        <summary className="muted">I chose a device-held key and I am on a new phone</summary>
        <label htmlFor="rc">Recovery code</label>
        <input id="rc" type="text" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="row"><button type="button" className="secondary" onClick={restore}>Restore my key</button></div>
        {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      </details>
    </section>
  );
}

/** @param {{ api?: import('../lib/api.js').Api, deviceKeys?: boolean }} props */
export function App({ api: injected, deviceKeys = true }) {
  const api = useMemo(() => injected || createApi(TOKEN), [injected]);
  const [view, setView] = useState('loading'); // loading landing onboard inbox data
  const [mode, setMode] = useState(/** @type {'server' | 'device'} */ ('server'));
  const [invite, setInvite] = useState(/** @type {string | null} */ (readInvite()));
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [tick, setTick] = useState(0);

  const refreshQueued = useCallback(async () => setQueued((await pending()).length), []);

  const sync = useCallback(async () => {
    const m = (await kvGet(MODE)) || 'server';
    const r = await flush((cardId, p) => sendEstimate(api, m, cardId, p));
    await refreshQueued();
    if (r.sent) setTick((t) => t + 1);
  }, [api, refreshQueued]);

  useEffect(() => {
    (async () => {
      setMode(/** @type {'server' | 'device'} */ ((await kvGet(MODE)) || 'server'));
      if (invite) { setView('onboard'); return; }
      setView((await kvGet(TOKEN)) ? 'inbox' : 'landing');
      refreshQueued();
    })();
  }, [invite, refreshQueued]);

  useEffect(() => {
    const up = () => { setOnline(true); sync(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [sync]);

  async function signedIn({ token, mode: m }) {
    await kvSet(TOKEN, token); await kvSet(MODE, m || 'server');
    setMode(/** @type {'server' | 'device'} */ (m || 'server')); setInvite(null);
    window.history.replaceState(null, '', window.location.pathname);
    setView('inbox');
  }
  const expired = useCallback(async () => { await kvDel(TOKEN); setView('landing'); }, []);
  const out = async () => { await kvDel(TOKEN); await kvDel(MODE); setView('landing'); };

  return (
    <>
      <header>
        <h1>Ground Truth</h1>
        {(view === 'inbox' || view === 'data') && (
          <nav aria-label="Main">
            <button type="button" className="secondary" onClick={() => setView('inbox')}>Questions</button>
            <button type="button" className="secondary" onClick={() => setView('data')}>My data</button>
            <button type="button" className="secondary" onClick={out}>Sign out</button>
          </nav>
        )}
      </header>
      {!online && <div className="banner" role="status">You are offline. You can still answer; answers are sent when you reconnect.</div>}
      {online && queued > 0 && <div className="banner" role="status">{queued} answer{queued === 1 ? '' : 's'} waiting to send. <button type="button" className="secondary" onClick={sync}>Send now</button></div>}
      <main>
        {view === 'loading' && <p>Loading…</p>}
        {view === 'landing' && <Landing onRestored={() => hasDeviceSecret()} />}
        {view === 'onboard' && invite && <Onboard api={api} invite={invite} deviceKeys={deviceKeys} onDone={signedIn} />}
        {view === 'inbox' && <Inbox api={api} mode={mode} onExpired={expired} refreshKey={tick} />}
        {view === 'data' && <MyData api={api} mode={mode} onErased={out} />}
      </main>
    </>
  );
}
