import { useState } from 'react';
import { useLoad, problems } from './hooks.js';

const SOURCES = ['ACLED', 'IPC', 'UNHCR', 'IMF', 'official_decree'];
const BANDS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
const blank = { statement: '', country: '', region: '', theme: '', from: '', to: '', objective: '', source: 'ACLED', resolver: '', probability: 'Medium' };
const MAX_SOURCES = 8;
const lines = (/** @type {string} */ s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/** Background for the second look, written while Round 1 is open. The service checks it; this only sends it. @param {{ api: import('../lib/api.js').Api, c: any, reload: () => void }} props */
function SecondLookEditor({ api, c, reload }) {
  const [open, setOpen] = useState(false);
  const [acaps, setAcaps] = useState('');
  const [sources, setSources] = useState(/** @type {Array<{ label: string, url: string }>} */ ([]));
  const [higher, setHigher] = useState('');
  const [lower, setLower] = useState('');
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  const [loaded, setLoaded] = useState(false);
  const setSource = (i, k, v) => setSources(sources.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  // Opening the editor on a card that already has background starts from the saved text, so a
  // moderator changes one line instead of retyping everything (and cannot overwrite it by accident).
  async function toggle() {
    const opening = !open;
    setOpen(opening);
    if (!opening || loaded || !c.hasSecondLook) return;
    try {
      const r = await api('GET', `/api/staff/cards/${c.id}/second-look`);
      if (r.content) {
        setAcaps(r.content.acapsReasoning); setSources(r.content.sources.map((/** @type {any} */ s) => ({ label: s.label, url: s.url })));
        setHigher(r.content.higher.join('\n')); setLower(r.content.lower.join('\n'));
      }
      setLoaded(true);
    } catch (e) { setMsg({ kind: 'err', text: `Could not load the saved background: ${problems(e)}. Saving now would replace it.` }); }
  }
  async function save() {
    try {
      await api('PUT', `/api/staff/cards/${c.id}/second-look`, {
        acapsReasoning: acaps,
        sources: sources.filter((s) => s.label.trim() || s.url.trim()).map((s) => ({ label: s.label.trim(), url: s.url.trim() })),
        higher: lines(higher),
        lower: lines(lower),
      });
      setMsg({ kind: 'ok', text: 'Saved' });
      reload();
    } catch (e) { setMsg({ kind: 'err', text: problems(e) }); }
  }
  return (
    <div>
      <button type="button" className="secondary" aria-expanded={open} onClick={toggle}>Background for the second look</button>
      {open && (
        <div>
          <p className="muted">Fixed once Round 1 closes. Do not include any probability or percentage: it is rejected.</p>
          <label htmlFor={`ar-${c.id}`}>ACAPS’s reasoning</label>
          <textarea id={`ar-${c.id}`} value={acaps} onChange={(e) => setAcaps(e.target.value)} />
          {sources.map((s, i) => (
            <div key={i} className="row">
              <label htmlFor={`sl-${c.id}-${i}`} className="plain">Source label {i + 1}</label>
              <input id={`sl-${c.id}-${i}`} type="text" value={s.label} onChange={(e) => setSource(i, 'label', e.target.value)} />
              <label htmlFor={`su-${c.id}-${i}`} className="plain">Source link {i + 1} (https)</label>
              <input id={`su-${c.id}-${i}`} type="url" value={s.url} onChange={(e) => setSource(i, 'url', e.target.value)} />
              <button type="button" className="secondary" onClick={() => setSources(sources.filter((_, j) => j !== i))}>Remove source {i + 1}</button>
            </div>
          ))}
          <div className="row"><button type="button" className="secondary" disabled={sources.length >= MAX_SOURCES} onClick={() => setSources([...sources, { label: '', url: '' }])}>Add source</button></div>
          <label htmlFor={`h-${c.id}`}>Reasons it could be more likely (one per line, 1 to 5)</label>
          <textarea id={`h-${c.id}`} value={higher} onChange={(e) => setHigher(e.target.value)} />
          <label htmlFor={`l-${c.id}`}>Reasons it could be less likely (one per line, 1 to 5)</label>
          <textarea id={`l-${c.id}`} value={lower} onChange={(e) => setLower(e.target.value)} />
          <div className="row"><button type="button" onClick={save}>Save background</button></div>
          {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
        </div>
      )}
    </div>
  );
}

function Row({ api, c, reload }) {
  const [resolve, setResolve] = useState(false);
  const [outcome, setOutcome] = useState('1');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState('');
  const act = async (fn) => { try { await fn(); setMsg(''); reload(); } catch (e) { setMsg(problems(e)); } };
  return (
    <tr>
      <td><strong>{c.id}</strong><br />{c.statement}</td>
      <td className="state"><span className={`tag ${c.status === 'open' ? 'teal' : c.status === 'closed' ? 'amber' : ''}`}>{c.status}</span><span className="tag">round {c.round}</span>{c.hasSecondLook && <span className="tag indigo">background set</span>}<br />{c.responses} {c.responses === 1 ? 'answer' : 'answers'}</td>
      <td className="actions">
        {c.status === 'open' && <button type="button" className="secondary" onClick={() => act(() => api('POST', `/api/staff/cards/${c.id}/close`))}>Close round</button>}
        {c.status === 'closed' && c.round === 1 && <button type="button" className="secondary" onClick={() => act(() => api('POST', `/api/staff/cards/${c.id}/round2`))}>Open round 2</button>}
        {['open', 'closed'].includes(c.status) && <button type="button" className="secondary" onClick={() => setResolve(!resolve)}>Resolve</button>}
        <button type="button" className="secondary" onClick={() => act(async () => {
          const r = await api('GET', `/api/cards/${c.id}/release`);
          setMsg(r.suppressed ? `Withheld: ${r.reason || `needs at least ${r.needed} answers (has ${r.n})`}` : `${r.n} experts: ${Math.round(r.estimate * 100)}% (${Math.round(r.lo * 100)}–${Math.round(r.hi * 100)}%)`);
        })}>Panel result</button>
        {resolve && (
          <div>
            <label htmlFor={`o-${c.id}`}>Outcome</label>
            <select id={`o-${c.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="1">It happened</option><option value="0">It did not</option><option value="unobservable">Could not be observed</option>
            </select>
            <label htmlFor={`e-${c.id}`}>Evidence link (https)</label>
            <input id={`e-${c.id}`} type="url" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            <div className="row"><button type="button" onClick={() => act(() => api('POST', `/api/staff/cards/${c.id}/resolve`, { outcome: outcome === 'unobservable' ? outcome : Number(outcome), evidenceUrl: evidence }))}>Record outcome</button></div>
          </div>
        )}
        {c.status === 'open' && c.round === 1 && <SecondLookEditor api={api} c={c} reload={reload} />}
        {msg && <div className="msg warn" role="status">{msg}</div>}
      </td>
    </tr>
  );
}

export function Cards({ api }) {
  const { data, error, reload } = useLoad(() => api('GET', '/api/staff/cards'));
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function create() {
    try {
      const r = await api('POST', '/api/staff/cards', {
        statement: f.statement, country: f.country, region: f.region || undefined, theme: f.theme || undefined,
        window: { from: f.from, to: f.to }, objective: f.objective, resolutionSource: f.source, resolver: f.resolver, probability: f.probability,
      });
      setMsg({ kind: 'ok', text: `Created ${r.card.id}.${r.warnings.length ? ` Warnings: ${r.warnings.join('; ')}` : ''}` });
      setF(blank); reload();
    } catch (e) { setMsg({ kind: 'err', text: problems(e) }); }
  }
  return (
    <>
      <section>
        <h2>Cards</h2>
        {error && <div className="msg err" role="alert">{error}</div>}
        {data && (data.length
          ? <table className="stack"><thead><tr><th>Card</th><th>State</th><th>Actions</th></tr></thead><tbody>{data.map((c) => <Row key={c.id} api={api} c={c} reload={reload} />)}</tbody></table>
          : <p className="muted">No cards yet.</p>)}
      </section>
      <section>
        <h2>Author a card</h2>
        <p className="muted">A card opens only with real dates, a written objective, an external source and a named resolver, fixed now and never at resolution.</p>
        <div className="form-grid">
          <div className="field wide"><label htmlFor="statement">Statement</label><textarea id="statement" value={f.statement} onChange={set('statement')} /></div>
          <div className="field"><label htmlFor="country">Country (ISO code)</label><input id="country" type="text" value={f.country} onChange={set('country')} /></div>
          <div className="field"><label htmlFor="region">Region (optional)</label><input id="region" type="text" value={f.region} onChange={set('region')} /></div>
          <div className="field"><label htmlFor="theme">Theme (optional)</label><input id="theme" type="text" value={f.theme} onChange={set('theme')} /></div>
          <div className="field"><label htmlFor="source">Resolution source</label><select id="source" value={f.source} onChange={set('source')}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="from">Window starts</label><input id="from" type="date" value={f.from} onChange={set('from')} /></div>
          <div className="field"><label htmlFor="to">Window ends</label><input id="to" type="date" value={f.to} onChange={set('to')} /></div>
          <div className="field wide"><label htmlFor="objective">Objective: what exactly counts as “yes”?</label><textarea id="objective" value={f.objective} onChange={set('objective')} /></div>
          <div className="field"><label htmlFor="resolver">Named resolver</label><input id="resolver" type="text" value={f.resolver} onChange={set('resolver')} /></div>
          <div className="field"><label htmlFor="prob">ACAPS’s own rating of this risk (kept for scoring; never shown to experts before they answer)</label><select id="prob" value={f.probability} onChange={set('probability')}>{BANDS.map((s) => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="row"><button type="button" onClick={create}>Create card</button></div>
        {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      </section>
    </>
  );
}
