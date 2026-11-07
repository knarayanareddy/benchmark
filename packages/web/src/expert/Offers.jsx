import { useId, useState } from 'react';
import { asErr } from '../lib/api.js';
import '../credit.css';

const NAME_MIN = 2;
const NAME_MAX = 80;
const ORG_MAX = 120;

const when = (/** @type {string} */ iso) => `${new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`;

/** @param {{ mode: string, displayName?: string, organisation?: string | null } | null} credit */
function creditWords(credit) {
  if (!credit || credit.mode !== 'credited') return 'Published without your name.';
  return `Published with your name: ${credit.displayName}${credit.organisation ? `, ${credit.organisation}` : ''}.`;
}

/** Withdrawal is a two-step action: the first click only reveals what it does. */
function Withdraw({ api, item, onChange }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { await api('POST', `/api/publications/${encodeURIComponent(item.id)}/withdraw`); onChange(); }
    catch (e) { setErr(asErr(e).message); }
    finally { setBusy(false); }
  }
  if (!confirming) return <div className="row"><button type="button" className="secondary" onClick={() => setConfirming(true)}>Withdraw</button></div>;
  return (
    <div className="msg warn">
      <p>Withdrawing deletes the text and your name from our records. Copies that others have already taken cannot be recalled.</p>
      <div className="row">
        <button type="button" className="danger" onClick={go} disabled={busy}>Yes, withdraw it</button>
        <button type="button" className="secondary" onClick={() => setConfirming(false)}>Keep it</button>
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
    </div>
  );
}

/** The author's choice. Nothing is sent until they press the button; the server checks every rule again. */
function Respond({ api, item, onChange }) {
  const uid = useId();
  const [choice, setChoice] = useState(/** @type {'decline' | 'uncredited' | 'credited' | null} */ (null));
  const [text, setText] = useState(item.text);
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const nameLen = name.trim().length;
  const credited = choice === 'credited';
  const valid = choice === 'decline'
    || (choice === 'uncredited' && text.trim() !== '')
    || (credited && text.trim() !== '' && nameLen >= NAME_MIN && nameLen <= NAME_MAX && org.trim().length <= ORG_MAX && (!item.sensitive || ack));

  async function submit() {
    if (!choice) return;
    setBusy(true); setErr('');
    try {
      await api('POST', `/api/publications/${encodeURIComponent(item.id)}/respond`, {
        decision: choice,
        text,
        displayName: credited ? name.trim() : undefined,
        organisation: credited ? (org.trim() || undefined) : undefined,
        acknowledgedRisk: credited && !!item.sensitive && ack,
      });
      onChange();
    } catch (e) {
      setErr(asErr(e).message);
    } finally {
      setBusy(false);
    }
  }

  const radio = (/** @type {'decline' | 'uncredited' | 'credited'} */ value, label) => (
    <label className="choice">
      <input type="radio" name={`${uid}-choice`} value={value} checked={choice === value} onChange={() => setChoice(value)} />
      {label}
    </label>
  );

  return (
    <div className="credit-respond">
      <label htmlFor={`${uid}-text`}>The text to publish. You can change it.</label>
      <textarea id={`${uid}-text`} value={text} onChange={(e) => setText(e.target.value)} />
      <fieldset className="credit-choices">
        <legend>What would you like to do?</legend>
        {radio('decline', 'Do not publish')}
        {radio('uncredited', 'Publish without my name')}
        {radio('credited', 'Publish with my name')}
      </fieldset>
      {credited && (
        <div className="credit-name">
          <label htmlFor={`${uid}-name`}>Display name (2 to 80 characters)</label>
          <input id={`${uid}-name`} type="text" autoComplete="name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor={`${uid}-org`}>Organisation (optional, up to 120 characters)</label>
          <input id={`${uid}-org`} type="text" maxLength={ORG_MAX} value={org} onChange={(e) => setOrg(e.target.value)} />
          {item.sensitive && (
            <>
              <div className="callout amber">
                This contribution is from a sensitive context. Being named adds risk: people may work out who you are, and your name stays public for as long as the item is published.
              </div>
              <label className="choice">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I understand the risk of being named
              </label>
            </>
          )}
        </div>
      )}
      <div className="row">
        <button type="button" onClick={submit} disabled={!valid || busy}>Send my choice</button>
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
    </div>
  );
}

/** @param {{ api: import('../lib/api.js').Api, item: any, onChange: () => void }} props */
function Offer({ api, item, onChange }) {
  if (item.status === 'proposed') {
    return (
      <div className="card question credit-card">
        <h3>{item.cardStatement}</h3>
        <p>ACAPS would like to publish this one contribution of yours. It is your decision.</p>
        <p>Nothing is published without your yes. A second moderator checks it for safety first, and then there is a 48-hour wait.</p>
        <p>You can withdraw at any time. We then delete the text and your name from our records. Copies that others have already taken cannot be recalled.</p>
        <Respond api={api} item={item} onChange={onChange} />
        <Withdraw api={api} item={item} onChange={onChange} />
      </div>
    );
  }
  if (item.status === 'consented' || item.status === 'approved') {
    return (
      <div className="card question credit-card">
        <h3>{item.cardStatement}</h3>
        <p className="pre-wrap">{item.text}</p>
        <p className="muted">{creditWords(item.credit)}</p>
        {item.status === 'consented'
          ? <p><span className="pill">Waiting for a safety check</span></p>
          : <p><span className="pill teal">Approved; it can be published after {when(item.publishAfter)}</span></p>}
        <Withdraw api={api} item={item} onChange={onChange} />
      </div>
    );
  }
  if (item.status === 'published') {
    return (
      <div className="card question credit-card">
        <h3>{item.cardStatement}</h3>
        <p><span className="pill teal">Published</span></p>
        <p className="pre-wrap">{item.text}</p>
        <p className="muted">{creditWords(item.credit)}</p>
        <p className="muted">Copies that others have already taken cannot be recalled.</p>
        <Withdraw api={api} item={item} onChange={onChange} />
      </div>
    );
  }
  if (item.status === 'rejected') {
    return (
      <div className="card question credit-card">
        <h3>{item.cardStatement}</h3>
        <p><span className="pill">Not published</span></p>
        {item.note && <p>Moderator's note: {item.note}</p>}
      </div>
    );
  }
  return null;
}

/** @param {{ api: import('../lib/api.js').Api, items: any[], onChange: () => void }} props */
export function Offers({ api, items, onChange }) {
  return (
    <section aria-label="Publication offers">
      <h2>A contribution of yours could be published</h2>
      {items.map((item) => <Offer key={item.id} api={api} item={item} onChange={onChange} />)}
    </section>
  );
}
