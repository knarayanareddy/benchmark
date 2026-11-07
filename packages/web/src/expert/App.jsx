import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi } from '../lib/api.js';
import { kvGet, kvSet, kvDel } from '../lib/kv.js';
import { flush, pending } from '../lib/queue.js';
import { sendEstimate } from '../lib/send.js';
import { setSecret, hasDeviceSecret } from '../lib/device.js';
import { decodeRecovery } from '../lib/recovery.js';
import { Join } from './Join.jsx';
import { Inbox } from './Inbox.jsx';
import { MyData } from './MyData.jsx';
import { Pulse } from './Pulse.jsx';
import { Risks } from './Risks.jsx';
import { Profile } from './Profile.jsx';
import { DemoBanner } from '../DemoBanner.jsx';
import { getConfig } from '../lib/config.js';

const TOKEN = 'session.expert';
const MODE = 'session.mode';

export function readInvite() {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite');
}

function Landing({ onRestored, demo, onJoin, onDemo }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  async function restore() {
    try { await setSecret(decodeRecovery(code)); setMsg({ kind: 'ok', text: 'Key restored on this device. Now open your personal link to sign in.' }); onRestored?.(); }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
  }
  return (
    <section className="hero">
      <p className="eyebrow">Invitation-only expert panel</p>
      <h2>Ground Truth</h2>
      <p className="page-sub">You help sharpen risk analysis by saying how likely you think an event is, in your own words and numbers, and by telling the analysts when a question is badly framed. You choose how identifiable you are, and you can erase everything.</p>
      <p>This is an invitation-only panel. Open the personal link you were sent to take part. If your link has expired, ask your coordinator for a new one.</p>
      <div className="row">
        <button type="button" onClick={onJoin}>I have an invitation</button>
        {demo && <button type="button" className="secondary" onClick={onDemo}>Join the demo</button>}
      </div>
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
  const [view, setView] = useState('loading'); // loading landing onboard demo setup pulse inbox risks data
  const [config, setConfig] = useState(/** @type {import('../lib/config.js').Config | null} */ (null));
  const [mode, setMode] = useState(/** @type {'server' | 'device'} */ ('server'));
  const [invite, setInvite] = useState(/** @type {string | null} */ (readInvite()));
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [tick, setTick] = useState(0);

  const refreshQueued = useCallback(async () => setQueued((await pending()).length), []);

  /** Where a signed-in person lands: the profile form the first time, Pulse after that. A failed check never blocks them. */
  const enter = useCallback(async () => {
    try {
      const p = await api('GET', '/api/me/profile');
      setView(p && p.needsSetup ? 'setup' : 'pulse');
    } catch { setView('pulse'); }
  }, [api]);

  useEffect(() => { getConfig().then(setConfig); }, []);

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
      if (await kvGet(TOKEN)) await enter(); else setView('landing');
      refreshQueued();
    })();
  }, [invite, refreshQueued, enter]);

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
    await enter();
  }
  const expired = useCallback(async () => { await kvDel(TOKEN); setView('landing'); }, []);
  const out = async () => { await kvDel(TOKEN); await kvDel(MODE); setView('landing'); };

  return (
    <>
      <header>
        <h1>Ground Truth</h1>
        {(view === 'pulse' || view === 'inbox' || view === 'risks' || view === 'data') && (
          <nav aria-label="Main">
            <button type="button" className="secondary" aria-current={view === 'pulse' ? 'page' : undefined} onClick={() => setView('pulse')}>Pulse</button>
            <button type="button" className="secondary" aria-current={view === 'inbox' ? 'page' : undefined} onClick={() => setView('inbox')}>Questions</button>
            <button type="button" className="secondary" aria-current={view === 'risks' ? 'page' : undefined} onClick={() => setView('risks')}>Risks</button>
            <button type="button" className="secondary" aria-current={view === 'data' ? 'page' : undefined} onClick={() => setView('data')}>My data</button>
            <button type="button" className="secondary" onClick={out}>Sign out</button>
          </nav>
        )}
      </header>
      <DemoBanner />
      {!online && <div className="banner" role="status">You are offline. You can still answer; answers are sent when you reconnect.</div>}
      {online && queued > 0 && <div className="banner" role="status">{queued} answer{queued === 1 ? '' : 's'} waiting to send. <button type="button" className="secondary" onClick={sync}>Send now</button></div>}
      <main>
        {view === 'loading' && <p>Loading…</p>}
        {view === 'landing' && <Landing onRestored={() => hasDeviceSecret()} demo={config?.demo === true} onJoin={() => setView('onboard')} onDemo={() => setView('demo')} />}
        {(view === 'onboard' || view === 'demo') && !config && <p>Loading…</p>}
        {view === 'onboard' && config && <Join api={api} invite={invite} demo={false} deviceKeys={deviceKeys && config.deviceKeys} breakGlass={config.breakGlass} onDone={signedIn} onCancel={() => setView('landing')} />}
        {view === 'demo' && config && <Join api={api} invite={null} demo deviceKeys={deviceKeys && config.deviceKeys} breakGlass={config.breakGlass} onDone={signedIn} onCancel={() => setView('landing')} />}
        {view === 'setup' && <Profile api={api} setup onSaved={() => setView('pulse')} />}
        {view === 'pulse' && <Pulse api={api} mode={mode} onExpired={expired} onOpenQuestions={() => setView('inbox')} refreshKey={tick} />}
        {view === 'inbox' && <Inbox api={api} mode={mode} onExpired={expired} refreshKey={tick} />}
        {view === 'risks' && <Risks api={api} onExpired={expired} />}
        {view === 'data' && <><Profile api={api} /><MyData api={api} mode={mode} onErased={out} /></>}
      </main>
    </>
  );
}
