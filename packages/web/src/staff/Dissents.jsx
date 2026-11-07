import { useState } from 'react';
import { useLoad, problems } from './hooks.js';

function Item({ api, d, reload }) {
  const [action, setAction] = useState('rewrite');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const v = d.version;
  const run = (label, fn, cls = 'secondary') => (
    <button type="button" className={cls} onClick={async () => { try { await fn(); reload(); } catch (e) { setMsg(problems(e)); } }}>{label}</button>
  );
  const base = `/api/staff/dissents/${d.id}`;
  return (
    <div className="card">
      <p><span className="tag">{d.status}</span><span className="tag">{d.kind}</span><span className="tag">{d.by}</span> on {d.cardId}</p>
      <p>{d.text || '(no text)'}</p>
      <div className="row">
        {d.status === 'open' && run('Route to review', () => api('POST', `${base}/route`, { expectedVersion: v }))}
        {d.status === 'routed' && (
          <>
            <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>{['rewrite', 'split', 'retire', 'resolve_early'].map((a) => <option key={a}>{a}</option>)}</select>
            <textarea aria-label="New statements" placeholder="New statement(s), one per line (rewrite: 1, split: 2 or more)" value={text} onChange={(e) => setText(e.target.value)} />
            {run('Act', () => api('POST', `${base}/act`, { expectedVersion: v, action, title: text.split('\n')[0].slice(0, 80), statements: text.split('\n').map((s) => s.trim()).filter(Boolean) }), '')}
          </>
        )}
        {d.status === 'actioned' && <>
          {run('Notify the expert', () => api('POST', `${base}/notify`, { expectedVersion: v }))}
          {run('Close', () => api('POST', `${base}/close`, { expectedVersion: v, reason: 'anonymous_actioned_on_card' }))}
        </>}
        {d.status === 'notified' && run('Close', () => api('POST', `${base}/close`, { expectedVersion: v, reason: 'notified' }))}
      </div>
      {msg && <div className="msg err" role="alert">{msg}</div>}
    </div>
  );
}

export function Dissents({ api }) {
  const { data, error, reload } = useLoad(() => api('GET', '/api/staff/dissents'));
  const open = (data || []).filter((d) => d.status !== 'closed');
  return (
    <>
      <h2>Objections</h2>
      {error && <div className="msg err" role="alert">{error}</div>}
      {data && (open.length ? open.map((d) => <Item key={d.id} api={api} d={d} reload={reload} />) : <p className="muted">Nothing open.</p>)}
    </>
  );
}
