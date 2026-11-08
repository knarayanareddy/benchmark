import { useLoad } from './hooks.js';

export function Audit({ api }) {
  const { data, error } = useLoad(() => api('GET', '/api/staff/audit'));
  return (
    <section>
      <h2>Audit log</h2>
      <p className="muted">Append-only. Expert answers are deliberately not logged.</p>
      {error && <div className="msg err" role="alert">{error}</div>}
      {data && (
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Note</th></tr></thead>
          <tbody>{data.slice().reverse().map((r, i) => (
            <tr key={i}><td>{new Date(r.at).toISOString().replace('T', ' ').slice(0, 19)}</td><td>{r.actorId} ({r.role})</td><td>{r.action}</td><td>{r.target}</td><td>{r.reason}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
