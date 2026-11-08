import { useState } from 'react';
import { useLoad, problems } from './hooks.js';

const CATEGORIES = [['safety_threat', 'A threat to someone\'s safety'], ['safety_welfare', 'Welfare'], ['legal_obligation', 'A legal obligation']];

function Request({ api, r, me, reload }) {
  const [key, setKey] = useState('');
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [msg, setMsg] = useState('');
  const mine = r.requester === me.id;
  const go = async (fn) => { try { setMsg(''); await fn(); reload(); } catch (e) { setMsg(problems(e)); } };
  return (
    <div className="card">
      <p><span className="tag">{r.status}</span><span className="tag">{r.category}</span> objection {r.dissentId}</p>
      <p className="muted">Asked by {r.requester}{r.approver ? `, decided by ${r.approver}` : ''}. Reason: {r.reason}</p>
      {r.status === 'requested' && !mine && (
        <div className="row">
          <button type="button" onClick={() => go(() => api('POST', `/api/staff/breakglass/${r.id}/decide`, { approve: true, note: 'approved' }))}>Approve</button>
          <button type="button" className="secondary" onClick={() => go(() => api('POST', `/api/staff/breakglass/${r.id}/decide`, { approve: false, note: 'denied' }))}>Deny</button>
        </div>
      )}
      {r.status === 'requested' && mine && <p className="muted">A different moderator must decide.</p>}
      {r.status === 'approved' && mine && !result && (
        <div>
          <label htmlFor={`k-${r.id}`}>Break-glass private key (PEM). It is not held by the service.</label>
          <textarea id={`k-${r.id}`} value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="row"><button type="button" onClick={() => go(async () => setResult(await api('POST', `/api/staff/breakglass/${r.id}/collect`, { key: key || undefined })))}>Open the sealed note once</button></div>
        </div>
      )}
      {result && (
        <div className="msg warn" role="status">
          {result.erased ? 'The sender has since erased their account: there is nobody to identify.'
            : <>Sender: <strong>{result.name || result.expertId}</strong> ({result.countries.join(', ')}). This is shown once and stored nowhere. The expert has been told.</>}
        </div>
      )}
      {msg && <div className="msg err" role="alert">{msg}</div>}
    </div>
  );
}

export function BreakGlass({ api, me }) {
  const dissents = useLoad(() => api('GET', '/api/staff/dissents'));
  const requests = useLoad(() => api('GET', '/api/staff/breakglass'));
  const [pick, setPick] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0][0]);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));

  if (me.role !== 'moderator') return <section><h2>Safety override</h2><p className="muted">Only moderators can use this.</p></section>;
  const sealed = (dissents.data || []).filter((d) => d.canBreakGlass && !(requests.data || []).some((r) => r.dissentId === d.id && ['requested', 'approved'].includes(r.status)));

  async function ask() {
    try {
      await api('POST', '/api/staff/breakglass', { dissentId: pick, category, reason });
      setMsg({ kind: 'ok', text: 'Requested. A different moderator must now approve it.' }); setReason(''); requests.reload();
    } catch (e) { setMsg({ kind: 'err', text: problems(e) }); }
  }
  return (
    <>
      <section>
        <h2>Safety override</h2>
        <p className="muted">For a serious safety or legal concern only. Two moderators are needed, the sender is told afterwards, and every step is in the audit log. Only anonymous objections can be opened, and only if the sender did not keep their key on their own device.</p>
        <label htmlFor="pick">Objection</label>
        <select id="pick" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose…</option>
          {sealed.map((d) => <option key={d.id} value={d.id}>{d.cardId}: {String(d.text).slice(0, 60)}</option>)}
        </select>
        <label htmlFor="cat">Kind of concern</label>
        <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        <label htmlFor="reason">Reason (at least 20 characters; it is kept in the audit log)</label>
        <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="row"><button type="button" disabled={!pick} onClick={ask}>Request</button></div>
        {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      </section>
      <h2>Requests</h2>
      {requests.data && (requests.data.length ? requests.data.slice().reverse().map((r) => <Request key={r.id} api={api} r={r} me={me} reload={requests.reload} />) : <p className="muted">None.</p>)}
    </>
  );
}
