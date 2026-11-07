import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi, asErr } from '../lib/api.js';
import { kvSet, kvDel } from '../lib/kv.js';
import { Cards } from './Cards.jsx';
import { Dissents } from './Dissents.jsx';
import { BreakGlass } from './BreakGlass.jsx';
import { Invites } from './Invites.jsx';
import { SecondLook } from './SecondLook.jsx';
import { Discussion } from './Discussion.jsx';
import { PublicationStaff } from './PublicationStaff.jsx';
import { Dispatch } from './Dispatch.jsx';
import { Evolution } from './Evolution.jsx';
import { DemoBanner } from '../DemoBanner.jsx';
import { Audit } from './Audit.jsx';

const TOKEN = 'session.staff';
/** @type {Array<[string, string, (p: { api: import('../lib/api.js').Api, me: { id: string, role: string }, draft?: any, setDraft?: (d: any) => void, goto?: (tab: string) => void }) => any]>} */
const TABS = [['cards', 'Cards', Cards], ['dispatch', 'Dispatch', Dispatch], ['evolution', 'Evolution', Evolution], ['dissents', 'Objections', Dissents], ['breakglass', 'Safety override', BreakGlass], ['invites', 'Invites', Invites], ['secondlook', 'Second look', SecondLook], ['discussion', 'Discussion', Discussion], ['publications', 'Publication', PublicationStaff], ['audit', 'Audit', Audit]];

function SignIn({ api, onDone }) {
  const [cred, setCred] = useState('');
  const [error, setError] = useState('');
  async function go() {
    try { const r = await api('POST', '/api/staff/session', { credential: cred }); await onDone(r.sessionToken); } catch (e) { setError(asErr(e).message); }
  }
  return (
    <section>
      <h2>Staff sign-in</h2>
      <p>Sign in with your organisation account.</p>
      <div className="row"><a className="btn" href="/api/staff/oidc/login">Sign in with SSO</a></div>
      <details>
        <summary className="muted">Pilot credential (only if SSO is not configured)</summary>
        <label htmlFor="cred">Credential</label>
        <input id="cred" type="text" autoComplete="off" value={cred} onChange={(e) => setCred(e.target.value)} />
        <div className="row"><button type="button" className="secondary" onClick={go}>Sign in</button></div>
      </details>
      {error && <div className="msg err" role="alert">{error}</div>}
    </section>
  );
}

/** @param {{ api?: import('../lib/api.js').Api }} props */
export function StaffApp({ api: injected }) {
  const api = useMemo(() => injected || createApi(TOKEN), [injected]);
  const [me, setMe] = useState(/** @type {{ id: string, role: string } | null} */ (null));
  const [tab, setTab] = useState('cards');
  // A card drafted from a risk in the Dispatch tab, handed to the Cards form.
  const [draft, setDraft] = useState(/** @type {any} */ (null));
  const [phase, setPhase] = useState('loading');

  const load = useCallback(async () => {
    try { setMe(await api('GET', '/api/staff/me')); setPhase('in'); } catch { setPhase('out'); }
  }, [api]);

  useEffect(() => {
    (async () => {
      // The SSO callback leaves the token in the URL fragment so it never reaches a server log or a Referer header.
      const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (t) { await kvSet(TOKEN, t); window.history.replaceState(null, '', window.location.pathname); }
      load();
    })();
  }, [load]);

  const signedIn = async (token) => { await kvSet(TOKEN, token); await load(); };
  const out = async () => { await kvDel(TOKEN); setMe(null); setPhase('out'); };
  const Current = (TABS.find(([id]) => id === tab) ?? TABS[0])[2];

  return (
    <>
      <header>
        <h1>Ground Truth — staff</h1>
        {phase === 'in' && (
          <nav aria-label="Staff">
            {TABS.map(([id, label]) => <button key={id} type="button" className="secondary" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
            <button type="button" className="secondary" onClick={out}>Sign out</button>
          </nav>
        )}
      </header>
      <DemoBanner staff />
      <main>
        {phase === 'loading' && <p>Loading…</p>}
        {phase === 'out' && <SignIn api={api} onDone={signedIn} />}
        {phase === 'in' && me && <><p className="muted">Signed in as {me.id} ({me.role})</p><Current api={api} me={me} draft={draft} setDraft={setDraft} goto={setTab} /></>}
      </main>
    </>
  );
}
