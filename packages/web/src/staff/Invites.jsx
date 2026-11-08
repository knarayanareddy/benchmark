import { useState } from 'react';
import { useLoad, problems } from './hooks.js';

export function Invites({ api, me }) {
  const experts = useLoad(() => api('GET', '/api/staff/experts').catch(() => []));
  const [name, setName] = useState('');
  const [countries, setCountries] = useState('');
  const [themes, setThemes] = useState('');
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const show = (token) => setLink(`${window.location.origin}/#invite=${token}`);

  async function create() {
    try {
      const r = await api('POST', '/api/staff/invites', { name: name || undefined, declaration: { countries: list(countries), themes: list(themes) } });
      show(r.token); setMsg(null); experts.reload();
    } catch (e) { setLink(''); setMsg({ kind: 'err', text: problems(e) }); }
  }
  async function reinvite(id) {
    try { show((await api('POST', `/api/staff/experts/${id}/reinvite`)).token); setMsg(null); } catch (e) { setLink(''); setMsg({ kind: 'err', text: problems(e) }); }
  }
  async function retention() {
    try { const r = await api('POST', '/api/staff/retention', {}); setMsg({ kind: 'ok', text: `Removed ${r.removed} rows.` }); } catch (e) { setMsg({ kind: 'err', text: problems(e) }); }
  }
  if (me.role !== 'moderator') return <section><h2>Invites</h2><p className="muted">Only moderators can invite.</p></section>;
  return (
    <>
      <section>
        <h2>Invite an expert</h2>
        <p className="muted">The link works once and is shown once. It is bound to the countries below.</p>
        <label htmlFor="name">Name (optional, kept on the roster only)</label><input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="countries">Countries (ISO codes, at least one, comma-separated)</label><input id="countries" type="text" placeholder="TCD, SDN" value={countries} onChange={(e) => setCountries(e.target.value)} />
        <label htmlFor="themes">Themes (optional)</label><input id="themes" type="text" value={themes} onChange={(e) => setThemes(e.target.value)} />
        <div className="row"><button type="button" onClick={create}>Create invite link</button></div>
        {link && <div className="msg ok">Copy this link now; it will not be shown again.<pre className="consent" data-testid="invite-link">{link}</pre></div>}
        {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      </section>
      <section>
        <h2>Experts</h2>
        <p className="muted">A returning expert (new phone, expired session) gets a fresh link. Their level and consent do not change.</p>
        {experts.data && (experts.data.length
          ? <table className="stack"><thead><tr><th>Expert</th><th>Countries</th><th /></tr></thead><tbody>
            {experts.data.map((x) => (
              <tr key={x.id}><td>{x.name || x.id}{!x.joined && <span className="tag">not joined yet</span>}</td><td>{x.countries.join(', ')}</td>
                <td>{x.joined && <button type="button" className="secondary" onClick={() => reinvite(x.id)}>New link</button>}</td></tr>
            ))}</tbody></table>
          : <p className="muted">No experts yet.</p>)}
      </section>
      <section><h2>Retention</h2><p className="muted">Delete individual answers 12 months after a card resolves. Published aggregates stay.</p>
        <button type="button" className="secondary" onClick={retention}>Run retention</button></section>
    </>
  );
}
