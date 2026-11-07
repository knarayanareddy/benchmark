import { useState } from 'react';
import { useLoad, problems } from './hooks.js';

const SOURCES = ['ACLED', 'IPC', 'UNHCR', 'IMF', 'official_decree'];
const BANDS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
const blank = { statement: '', country: '', region: '', theme: '', from: '', to: '', objective: '', source: 'ACLED', resolver: '', probability: 'Medium' };

function Row({ api, c, reload }) {
  const [resolve, setResolve] = useState(false);
  const [outcome, setOutcome] = useState('1');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState('');
  const act = async (fn) => { try { await fn(); setMsg(''); reload(); } catch (e) { setMsg(problems(e)); } };
  return (
    <tr>
      <td><strong>{c.id}</strong><br />{c.statement}</td>
      <td><span className="tag">{c.status}</span><span className="tag">round {c.round}</span><br />{c.responses} answers</td>
      <td>
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
          ? <table><thead><tr><th>Card</th><th>State</th><th>Actions</th></tr></thead><tbody>{data.map((c) => <Row key={c.id} api={api} c={c} reload={reload} />)}</tbody></table>
          : <p className="muted">No cards yet.</p>)}
      </section>
      <section>
        <h2>Author a card</h2>
        <p className="muted">A card opens only with real dates, a written objective, an external source and a named resolver, fixed now and never at resolution.</p>
        <label htmlFor="statement">Statement</label><textarea id="statement" value={f.statement} onChange={set('statement')} />
        <label htmlFor="country">Country (ISO code)</label><input id="country" type="text" value={f.country} onChange={set('country')} />
        <label htmlFor="region">Region (optional)</label><input id="region" type="text" value={f.region} onChange={set('region')} />
        <label htmlFor="theme">Theme (optional)</label><input id="theme" type="text" value={f.theme} onChange={set('theme')} />
        <label htmlFor="from">Window starts</label><input id="from" type="date" value={f.from} onChange={set('from')} />
        <label htmlFor="to">Window ends</label><input id="to" type="date" value={f.to} onChange={set('to')} />
        <label htmlFor="objective">Objective: what exactly counts as “yes”?</label><textarea id="objective" value={f.objective} onChange={set('objective')} />
        <label htmlFor="source">Resolution source</label><select id="source" value={f.source} onChange={set('source')}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        <label htmlFor="resolver">Named resolver</label><input id="resolver" type="text" value={f.resolver} onChange={set('resolver')} />
        <label htmlFor="prob">ACAPS probability rating (seeds the card)</label><select id="prob" value={f.probability} onChange={set('probability')}>{BANDS.map((s) => <option key={s}>{s}</option>)}</select>
        <div className="row"><button type="button" onClick={create}>Create card</button></div>
        {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      </section>
    </>
  );
}
