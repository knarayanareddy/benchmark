import { useId, useState } from 'react';
import { asErr } from '../lib/api.js';
import { anonymous } from '../lib/send.js';
import { obtainBallot } from '../lib/device.js';
import '../roundtable.css';

/** @type {Record<string, string>} */
const KIND_LABELS = {
  claim: 'Claim', evidence: 'Evidence', counter: 'Counter-argument', question: 'Question', missing_risk: 'Missing risk', reply: 'Reply',
};
const MAX = 600;
// A quick local check so the person sees the problem before sending. The server applies the real rule.
const FIGURE = /%|\d\s*(per\s?cent|percent)/i;

/** @param {any} h a hint from the service: { kind, match } or plain text */
const hintText = (h) => (typeof h === 'string' ? h : h?.match ?? '');
const kindLabel = (/** @type {string} */ k) => KIND_LABELS[k] ?? k;

/**
 * The roundtable for one card: read the discussion, and (while posting is open) post or reply.
 * Device-held experts send their blind ballot instead of logging in.
 * @param {{ api: import('../lib/api.js').Api, card: any, mode: 'server' | 'device' }} props
 */
export function Thread({ api, card, mode }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('claim');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(/** @type {{ id: string, label: string, text: string } | null} */ (null));
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState(/** @type {{ kind: string, text: string } | null} */ (null));

  async function readThread() {
    if (mode === 'device') return anonymous('POST', '/api/anon/thread', await obtainBallot(api, card.id));
    return api('POST', '/api/thread', { cardId: card.id });
  }
  async function refresh() {
    try { setData(await readThread()); setError(''); } catch (e) { setError(asErr(e).message); }
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await refresh();
  }
  async function sendPost(/** @type {string} */ k, /** @type {string} */ body, /** @type {string | null} */ parentId) {
    if (mode === 'device') return anonymous('POST', '/api/anon/thread/posts', { ...(await obtainBallot(api, card.id)), kind: k, text: body, parentId });
    return api('POST', '/api/thread/posts', { cardId: card.id, kind: k, text: body, parentId });
  }

  async function submit(/** @type {import('react').FormEvent} */ e) {
    e.preventDefault();
    setNotice(null);
    if (!text.trim()) { setFormError('Write something first.'); return; }
    if (text.length > MAX) { setFormError(`Keep it to ${MAX} characters or fewer.`); return; }
    if (FIGURE.test(text)) { setFormError('Remove the number. Say why people might disagree, not how likely anyone thinks it is.'); return; }
    const effective = replyTo ? 'reply' : kind;
    setBusy(true);
    setFormError('');
    let r;
    try {
      r = await sendPost(effective, text, replyTo ? replyTo.id : null);
    } catch (err) {
      setFormError(asErr(err).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    const hints = (r && r.warnings) || [];
    setNotice(hints.length
      ? { kind: 'warn', text: `Your post is waiting for a moderator. Check it does not identify you or anyone else. Possible identifying detail: ${hints.map(hintText).join(', ')}.` }
      : { kind: 'ok', text: 'Your post is waiting for a moderator. Nobody else sees it until it is approved.' });
    setText('');
    setReplyTo(null);
    setKind('claim');
    await refresh();
  }

  if (!open) {
    return (
      <div className="thread">
        <button type="button" className="secondary" aria-expanded="false" onClick={toggle}>Open the discussion</button>
      </div>
    );
  }

  const close = <button type="button" className="secondary" aria-expanded="true" onClick={() => setOpen(false)}>Close the discussion</button>;
  if (error && !data) {
    return <div className="thread"><div className="msg err" role="alert">{error}</div><div className="row">{close}</div></div>;
  }
  if (!data) return <div className="thread"><p className="muted" role="status">Loading the discussion…</p><div className="row">{close}</div></div>;

  const top = data.posts.filter((/** @type {any} */ p) => !p.parentId);
  const topIds = new Set(top.map((/** @type {any} */ p) => p.id));
  // A reply whose parent is not in the list is shown at the top level rather than lost.
  const orphans = data.posts.filter((/** @type {any} */ p) => p.parentId && !topIds.has(p.parentId));
  const repliesTo = (/** @type {string} */ id) => data.posts.filter((/** @type {any} */ p) => p.parentId === id);
  const kindOptions = (data.kinds ?? Object.keys(KIND_LABELS)).filter((/** @type {string} */ k) => k !== 'reply');

  const renderPost = (/** @type {any} */ p, /** @type {boolean} */ reply) => (
    <li key={p.id} className={`thread-post${reply ? ' reply' : ''}`}>
      <div className="thread-meta">
        <span className="pill teal">{kindLabel(p.kind)}</span>
        <strong>{p.label}</strong>
        <span>{p.day}</span>
        {p.own && <span className="tag indigo">You</span>}
        {data.canPost && !reply && (
          <button type="button" className="secondary link" onClick={() => { setReplyTo({ id: p.id, label: p.label, text: p.text }); setKind('reply'); setFormError(''); setNotice(null); }}>Reply</button>
        )}
      </div>
      <p>{p.text}</p>
    </li>
  );

  return (
    <div className="thread">
      <div className="row">{close}</div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <h4>Discussion</h4>
      {top.length + orphans.length === 0 && <p className="muted">No posts have been approved yet.</p>}
      <ul className="thread-list">
        {top.map((/** @type {any} */ p) => (
          <li key={p.id}>
            <ul className="thread-list">{renderPost(p, false)}</ul>
            {repliesTo(p.id).length > 0 && <ul className="thread-replies">{repliesTo(p.id).map((/** @type {any} */ r) => renderPost(r, true))}</ul>}
          </li>
        ))}
        {orphans.map((/** @type {any} */ p) => renderPost(p, false))}
      </ul>

      {data.mine.length > 0 && (
        <section className="thread-mine" aria-label="Your posts">
          <h5>Your posts</h5>
          <ul className="thread-list">
            {data.mine.map((/** @type {any} */ m) => (
              <li key={m.id} className="thread-post">
                <div className="thread-meta">
                  <span className="pill teal">{kindLabel(m.kind)}</span>
                  {m.status === 'pending'
                    ? <span className="tag amber">Waiting for a moderator</span>
                    : <span className="tag amber">Not published</span>}
                </div>
                <p>{m.text}</p>
                {m.status === 'rejected' && <span className="muted">A moderator said: {m.note || 'no reason given'}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.canPost
        ? (
          <form className="thread-form" onSubmit={submit} aria-label="Post to the discussion">
            {replyTo && (
              <p className="muted">
                Replying to {replyTo.label}: “{replyTo.text.slice(0, 80)}{replyTo.text.length > 80 ? '…' : ''}” <button type="button" className="secondary link" onClick={() => { setReplyTo(null); setKind('claim'); }}>Cancel reply</button>
              </p>
            )}
            <label htmlFor={`${uid}-kind`}>Kind</label>
            <select id={`${uid}-kind`} value={replyTo ? 'reply' : kind} disabled={Boolean(replyTo)} onChange={(e) => setKind(e.target.value)}>
              {replyTo
                ? <option value="reply">Reply</option>
                : kindOptions.map((/** @type {string} */ k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
            <label htmlFor={`${uid}-text`}>Your post</label>
            <textarea id={`${uid}-text`} value={text} aria-describedby={`${uid}-help ${uid}-count`} onChange={(e) => setText(e.target.value)} />
            <p id={`${uid}-help`} className="muted">No numbers: do not say how likely you think it is. A moderator reads this before anyone else sees it.</p>
            <p id={`${uid}-count`} className="thread-counter">{text.length} of {MAX} characters. Limit: 5 posts per question, replies included.</p>
            {formError && <div className="msg err" role="alert">{formError}</div>}
            <div className="row"><button type="submit" disabled={busy}>Post</button></div>
          </form>
        )
        : <p className="muted">Posting is closed. You can still read the discussion.</p>}

      {notice && <div className={`msg ${notice.kind}`} role="status">{notice.text}</div>}
    </div>
  );
}
