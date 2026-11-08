import { useState } from 'react';
import { useLoad, problems } from './hooks.js';
import '../roundtable.css';

/** @type {Record<string, string>} */
const KIND_LABELS = {
  claim: 'Claim', evidence: 'Evidence', counter: 'Counter-argument', question: 'Question', missing_risk: 'Missing risk', reply: 'Reply',
};
const kindLabel = (/** @type {string} */ k) => KIND_LABELS[k] ?? k;
const hintText = (/** @type {any} */ h) => (typeof h === 'string' ? h : h?.match ?? '');

/** One pending post: the moderator reads it, then approves it or rejects it with a reason. @param {{ api: import('../lib/api.js').Api, p: any, reload: () => void, onError: (msg: string) => void }} props */
function PendingPost({ api, p, reload, onError }) {
  const [note, setNote] = useState('');
  const noteOk = note.trim().length >= 1 && note.length <= 300;
  const moderate = async (/** @type {any} */ body) => {
    try { await api('POST', `/api/staff/thread/posts/${p.id}/moderate`, body); onError(''); reload(); } catch (e) { onError(problems(e)); }
  };
  return (
    <tr>
      <td>
        <strong>{p.cardId}</strong> {p.statement}
        <div className="thread-meta"><span className="pill teal">{kindLabel(p.kind)}</span><strong>{p.label}</strong><span>{p.day}</span></div>
        <p className="moderation-text">{p.text}</p>
        {p.hints?.length > 0 && <div className="msg warn">Possible identifying detail: {p.hints.map(hintText).join(', ')}</div>}
      </td>
      <td className="actions">
        <button type="button" onClick={() => moderate({ approve: true })}>Approve</button>
        <div className="moderation-note">
          <label htmlFor={`note-${p.id}`}>Reason for rejecting (required, 1 to 300 characters)</label>
          <textarea id={`note-${p.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row"><button type="button" className="secondary" disabled={!noteOk} onClick={() => moderate({ approve: false, note: note.trim() })}>Reject</button></div>
        </div>
      </td>
    </tr>
  );
}

/** @param {{ api: import('../lib/api.js').Api }} props */
export function Discussion({ api }) {
  const cards = useLoad(() => api('GET', '/api/staff/cards'));
  const waiting = useLoad(() => api('GET', '/api/staff/thread/pending'));
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  const [queueError, setQueueError] = useState('');

  async function toggle(/** @type {any} */ c) {
    try {
      await api('PUT', `/api/staff/cards/${c.id}/thread`, { enabled: !c.threadEnabled });
      setMsg({ kind: 'ok', text: `Thread ${c.threadEnabled ? 'disabled' : 'enabled'} for ${c.id}.` });
      cards.reload();
    } catch (e) { setMsg({ kind: 'err', text: problems(e) }); }
  }

  return (
    <>
      <section>
        <h2>Threads</h2>
        <p className="muted">A thread lets experts who answered Round 1 discuss the question before Round 2. Turn it on only while the card is in Round 1. Round 2 cannot open while posts are waiting for you.</p>
        {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
        {cards.error && <div className="msg err" role="alert">{cards.error}</div>}
        {cards.data && (cards.data.length
          ? (
            <table className="stack">
              <thead><tr><th>Card</th><th>State</th><th>Thread</th></tr></thead>
              <tbody>
                {cards.data.map((/** @type {any} */ c) => (
                  <tr key={c.id}>
                    <td><strong>{c.id}</strong><br />{c.statement}</td>
                    <td><span className="tag">{c.status}</span><span className="tag">round {c.round}</span></td>
                    <td className="actions">
                      <span className={`tag ${c.threadEnabled ? 'teal' : ''}`}>{c.threadEnabled ? 'Thread on' : 'No thread'}</span>
                      {c.round === 1
                        ? <button type="button" className="secondary" onClick={() => toggle(c)}>{c.threadEnabled ? `Disable thread for ${c.id}` : `Enable thread for ${c.id}`}</button>
                        : <span className="muted">Only round 1 cards can change this.</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : <p className="muted">No cards yet.</p>)}
      </section>
      <section>
        <h2>Posts waiting for you</h2>
        <p className="muted">Read each post before approving it. Nobody else sees a post until it is approved. A rejection needs a short reason, which the expert will see.</p>
        {queueError && <div className="msg err" role="alert">{queueError}</div>}
        {waiting.error && <div className="msg err" role="alert">{waiting.error}</div>}
        {waiting.data && (waiting.data.length
          ? (
            <table className="stack">
              <thead><tr><th>Post</th><th>Decide</th></tr></thead>
              <tbody>
                {waiting.data.map((/** @type {any} */ p) => <PendingPost key={p.id} api={api} p={p} reload={waiting.reload} onError={setQueueError} />)}
              </tbody>
            </table>
          )
          : <p className="muted">No posts are waiting for you.</p>)}
      </section>
    </>
  );
}
