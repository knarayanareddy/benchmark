import { useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import { useLoad } from './hooks.js';
import '../credit.css';

const CHECKS = [
  ['noThirdParties', 'No third parties are identifiable'],
  ['noLocationDetail', 'No location detail that could identify someone'],
  ['riskUnderstood', 'The author understands the risk'],
];
const NOTE_MAX = 300;

const when = (/** @type {string} */ iso) => `${new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`;

/** Consent-then-review: a different moderator must approve, and every checklist item must be ticked. */
function Review({ api, row, me, reload, fail }) {
  const [checked, setChecked] = useState({ noThirdParties: false, noLocationDetail: false, riskUnderstood: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (me.id === row.proposer) return <p className="muted">A different moderator must review this.</p>;
  const allChecked = CHECKS.every(([k]) => checked[k]);
  const noteOk = note.trim() !== '';
  async function send(approve) {
    setBusy(true); fail('');
    try {
      await api('POST', `/api/staff/publications/${encodeURIComponent(row.id)}/review`, { approve, note: note.trim(), checked });
      reload();
    } catch (e) { fail(asErr(e).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="credit-review">
      <fieldset>
        <legend>Safety checklist</legend>
        {CHECKS.map(([k, label]) => (
          <label key={k} className="choice">
            <input type="checkbox" checked={checked[k]} onChange={(e) => setChecked({ ...checked, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`review-note-${row.id}`}>Note (required to reject)</label>
      <textarea id={`review-note-${row.id}`} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button type="button" onClick={() => send(true)} disabled={!allChecked || busy}>Approve</button>
        <button type="button" className="danger" onClick={() => send(false)} disabled={!noteOk || busy}>Reject</button>
      </div>
    </div>
  );
}

/** The clock the cooling-off check reads, refreshed so a page left open unlocks Publish when the wait ends. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** @param {{ api: import('../lib/api.js').Api, row: any, me: { id: string, role: string }, now: number, reload: () => void, fail: (m: string) => void }} props */
function Actions({ api, row, me, now, reload, fail }) {
  if (row.status === 'consented') return <Review api={api} row={row} me={me} reload={reload} fail={fail} />;
  if (row.status === 'approved') {
    const ready = now >= new Date(row.publishAfter).getTime();
    const publish = async () => {
      fail('');
      try { await api('POST', `/api/staff/publications/${encodeURIComponent(row.id)}/publish`); reload(); }
      catch (e) { fail(asErr(e).message); }
    };
    return (
      <>
        <button type="button" onClick={publish} disabled={!ready}>Publish</button>
        {!ready && <p className="muted">Available after {when(row.publishAfter)}</p>}
      </>
    );
  }
  return null;
}

/** @param {{ api: import('../lib/api.js').Api, me: { id: string, role: string } }} props */
export function PublicationStaff({ api, me }) {
  const { data, error, reload } = useLoad(() => api('GET', '/api/staff/publications'));
  const offerable = useLoad(() => api('GET', '/api/staff/publications/offerable'));
  const now = useNow();
  const [sourceKind, setSourceKind] = useState('dissent');
  const [sourceId, setSourceId] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function offer(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('POST', '/api/staff/publications', { sourceKind, sourceId: sourceId.trim() });
      setSourceId(''); setMsg('Offered. The author will be asked to decide.');
      reload(); offerable.reload();
    } catch (x) { setErr(asErr(x).message); }
  }

  async function offerItem(/** @type {any} */ item) {
    setErr(''); setMsg('');
    try {
      await api('POST', '/api/staff/publications', { sourceKind: item.sourceKind, sourceId: item.sourceId });
      setMsg('Offered. The author will be asked to decide.');
      reload(); offerable.reload();
    } catch (x) { setErr(asErr(x).message); }
  }

  return (
    <>
      <section>
        <h2>Ready to offer</h2>
        <p className="muted">Actioned objections and approved discussion posts whose author can be asked. Anonymous contributions never appear here, because their author cannot consent. You cannot review what you offer: a second moderator must.</p>
        {offerable.error && <div className="msg err" role="alert">{offerable.error}</div>}
        {offerable.data && offerable.data.length === 0 && <p className="muted">Nothing is waiting to be offered.</p>}
        {offerable.data && offerable.data.length > 0 && (
          <table className="stack">
            <thead><tr><th>Source</th><th>Contribution</th><th /></tr></thead>
            <tbody>
              {offerable.data.map((/** @type {any} */ item) => (
                <tr key={`${item.sourceKind}:${item.sourceId}`}>
                  <td><strong>{item.sourceKind === 'dissent' ? 'Objection' : 'Post'}</strong> {item.label ?? ''}<br /><span className="muted">{item.statement}</span></td>
                  <td><p className="pre-wrap">{item.text}</p></td>
                  <td className="actions"><button type="button" className="secondary" onClick={() => offerItem(item)}>Offer for publication</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2>Offer by id</h2>
        <p className="muted">If you already know the id of an objection or post. Only a keyed expert’s contribution can be offered.</p>
        <form className="credit-offer" onSubmit={offer}>
          <label htmlFor="pub-kind">Source kind</label>
          <select id="pub-kind" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            <option value="dissent">Objection</option>
            <option value="post">Discussion post</option>
          </select>
          <label htmlFor="pub-source">Source id</label>
          <input id="pub-source" type="text" autoComplete="off" value={sourceId} onChange={(e) => setSourceId(e.target.value)} />
          <div className="row"><button type="submit" disabled={sourceId.trim() === ''}>Offer for publication</button></div>
        </form>
        {msg && <div className="msg ok" role="status">{msg}</div>}
        {err && <div className="msg err" role="alert">{err}</div>}
      </section>
      <section>
        <h2>Publications</h2>
        {error && <div className="msg err" role="alert">{error}</div>}
        {!error && data === null && <p className="muted">Loading…</p>}
        {data && data.length === 0 && <p className="muted">No publications yet.</p>}
        {data && data.length > 0 && (
          <table className="stack">
            <thead><tr><th>Status</th><th>Source</th><th>Text and credit</th><th>People</th><th>Actions</th></tr></thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  <td><span className={`pill ${row.status === 'published' ? 'teal' : ''}`}>{row.status}</span></td>
                  <td><strong>{row.sourceKind}</strong> {row.cardId} {row.country}</td>
                  <td>
                    <p className="pre-wrap">{row.text}</p>
                    <p className="muted">{row.displayName ? `Named: ${row.displayName}` : 'Uncredited'}</p>
                  </td>
                  <td>
                    <p className="muted">Proposed by {row.proposer}{row.reviewer ? `; reviewed by ${row.reviewer}` : ''}</p>
                  </td>
                  <td>
                    <Actions api={api} row={row} me={me} now={now} reload={reload} fail={setErr} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
