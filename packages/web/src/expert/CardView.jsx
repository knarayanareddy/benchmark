import { useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import { sendEstimate } from '../lib/send.js';
import { enqueue } from '../lib/queue.js';
import { obtainBallot } from '../lib/device.js';
import { anonymous } from '../lib/send.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const KINDS = [
  ['two_risks', 'This is really two questions'], ['window', 'The time window is wrong'],
  ['already_happening', 'This has already happened'], ['intent_not_condition', 'This is about intent, not something observable'],
];

function describeRelease(r) {
  if (!r || r.suppressed) return <p className="muted">The panel result is not published yet.</p>;
  return <p>Panel ({r.n} experts): {pct(r.estimate)}, range {pct(r.lo)}–{pct(r.hi)}.</p>;
}

function Objection({ api, card }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[0][0]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));
  async function send() {
    try {
      const r = await api('POST', '/api/dissents', { cardId: card.id, kind, text });
      const w = r.warnings || [];
      setMsg(w.length ? { kind: 'warn', text: `Sent. Before it is read: ${w.join('; ')}. You may want to remove those details next time.` } : { kind: 'ok', text: 'Sent. We will tell you what changes.' });
      setText('');
    } catch (e) { setMsg({ kind: 'err', text: asErr(e).message }); }
  }
  return (
    <div>
      <div className="row"><button type="button" className="secondary" onClick={() => setOpen(!open)}>Something is wrong with this question</button></div>
      {open && (
        <div>
          <label htmlFor={`k-${card.id}`}>What is wrong?</label>
          <select id={`k-${card.id}`} value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          <label htmlFor={`t-${card.id}`}>Details</label>
          <textarea id={`t-${card.id}`} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say what is wrong with the question, not who you are." />
          <div className="row"><button type="button" onClick={send}>Send objection</button></div>
        </div>
      )}
      {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
    </div>
  );
}

/** @param {{ api: import('../lib/api.js').Api, card: any, mode: 'server' | 'device', revise?: boolean, onNext: () => void, onQueued?: () => void }} props */
export function CardView({ api, card, mode, revise = false, onNext, onQueued }) {
  const [first, setFirst] = useState(card.yourEstimate ?? null); // round-1 answer, for revisions
  const [blocked, setBlocked] = useState('');
  const start = first ?? card.seedP ?? 0.5;
  const [value, setValue] = useState(Math.round(start * 100));
  const [state, setState] = useState({ phase: 'idle', text: '' });

  // A device-held key means the server cannot say what this device already answered; the device asks.
  useEffect(() => {
    if (!(revise && card.deviceHeld)) return undefined;
    let live = true;
    (async () => {
      try {
        const b = await obtainBallot(api, card.id);
        const s = await anonymous('POST', '/api/anon/status', b);
        if (!live) return;
        if (s.round1 == null) setBlocked('You did not answer the first round, so there is nothing to revise.');
        else { setFirst(s.round1); setValue(Math.round(s.round1 * 100)); }
      } catch { if (live) setBlocked('This device cannot revise this question: it holds no ballot for it.'); }
    })();
    return () => { live = false; };
  }, [api, card.id, card.deviceHeld, revise]);

  async function submit() {
    setState({ phase: 'saving', text: '' });
    const p = value / 100;
    try {
      const r = await sendEstimate(api, mode, card.id, p);
      setState({ phase: 'saved', text: `Saved: ${pct(r.p)}${r.clamped ? ' (kept within 1–99%)' : ''}. Thank you.` });
    } catch (e) {
      const err = asErr(e);
      if (err.offline) {
        await enqueue(card.id, p);
        setState({ phase: 'queued', text: 'You are offline. Your answer is saved on this phone and will be sent when you are back online.' });
        onQueued?.();
      } else setState({ phase: 'error', text: err.message });
    }
  }

  const done = state.phase === 'saved' || state.phase === 'queued';
  return (
    <div className="card">
      <h3>{card.statement}</h3>
      <p className="muted">{card.country}{card.window ? ` · resolves by ${card.window.to}` : ''}{revise ? ' · round 2' : ''}</p>
      {revise
        ? <>{describeRelease(card.release)}{first != null && <p className="muted">Your first answer was {pct(first)}. You may revise it.</p>}</>
        : <p className="muted">Starts at ACAPS’ own reading ({pct(start)}). Move it to what you think.</p>}
      {blocked ? <div className="msg warn">{blocked}</div> : (
        <>
          <output className="big" htmlFor={`s-${card.id}`}>{value}%</output>
          <input type="range" id={`s-${card.id}`} min={1} max={99} step={1} value={value} disabled={done}
            aria-label="Your probability that this happens" onChange={(e) => setValue(Number(e.target.value))} />
          <div className="row">
            {done ? <button type="button" className="secondary" onClick={onNext}>Next question</button>
              : <button type="button" disabled={state.phase === 'saving'} onClick={submit}>{revise ? 'Save my revision' : 'Submit'}</button>}
          </div>
        </>
      )}
      {state.text && <div className={`msg ${state.phase === 'error' ? 'err' : state.phase === 'queued' ? 'warn' : 'ok'}`} role={state.phase === 'error' ? 'alert' : 'status'}>{state.text}</div>}
      <Objection api={api} card={card} />
    </div>
  );
}
