import { useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import { sendEstimate } from '../lib/send.js';
import { enqueue } from '../lib/queue.js';
import { obtainBallot } from '../lib/device.js';
import { anonymous } from '../lib/send.js';
import { SecondLook } from './SecondLook.jsx';
import { Thread } from './Thread.jsx';

const pct = (p) => `${Math.round(p * 100)}%`;
/** Plain words for the expert's own number, so a slider position means something. Never a reference to anyone else's view. @param {number} p */
function verbal(p) {
  if (p < 8) return 'Almost certainly not';
  if (p < 25) return 'Unlikely';
  if (p < 45) return 'Somewhat unlikely';
  if (p < 56) return 'A toss-up';
  if (p < 75) return 'Somewhat likely';
  if (p < 92) return 'Likely';
  return 'Almost certain';
}

const KINDS = [
  ['two_risks', 'This is really two questions'], ['window', 'The time window is wrong'],
  ['already_happening', 'This has already happened'], ['intent_not_condition', 'This is about intent, not something observable'],
];

function describeRelease(r) {
  if (!r || r.suppressed) return <p className="panel-line muted">The panel result is not published yet.</p>;
  return <p className="panel-line">Panel ({r.n} experts): {pct(r.estimate)}, range {pct(r.lo)}–{pct(r.hi)}.</p>;
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
      <div className="row"><button type="button" className="secondary link" onClick={() => setOpen(!open)}>Something is wrong with this question</button></div>
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
  // Round 1 is blind (rule R9): no ACAPS rating, no panel result, and no pre-filled number. The answer is
  // `null` until the expert has put one down, and Submit stays off until they have. A revision starts
  // from their OWN first answer.
  const [value, setValue] = useState(/** @type {number | null} */ (first == null ? null : Math.round(first * 100)));
  const valid = Number.isInteger(value) && /** @type {number} */ (value) >= 1 && /** @type {number} */ (value) <= 99;
  const [state, setState] = useState({ phase: 'idle', text: '' });
  const [look, setLook] = useState(/** @type {any} */ (null)); // the optional background, Round 2 only
  const [lookPhase, setLookPhase] = useState(/** @type {'idle' | 'loading'} */ ('idle'));
  const [lookError, setLookError] = useState('');

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

  /** Save one answer, the same way whether it is a new revision or the first answer kept. */
  async function save(p) {
    setState({ phase: 'saving', text: '' });
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
  async function submit() {
    if (!valid) return;
    await save(/** @type {number} */ (value) / 100);
  }

  /** The optional background. A device-held key proves its ballot first, exactly as an answer does. */
  async function openLook() {
    setLookPhase('loading'); setLookError('');
    try {
      const r = mode === 'device'
        ? await anonymous('POST', '/api/anon/second-look', await obtainBallot(api, card.id))
        : await api('POST', '/api/second-look', { cardId: card.id });
      setLook(r);
    } catch (e) { setLookError(asErr(e).message); } finally { setLookPhase('idle'); }
  }

  const done = state.phase === 'saved' || state.phase === 'queued';
  const busy = state.phase === 'saving';
  const lookBlock = revise && card.secondLook?.available && (look
    ? <SecondLook look={look} />
    : lookPhase === 'loading'
      ? <p className="muted">Loading…</p>
      : <div className="row"><button type="button" className="secondary" onClick={openLook}>Look at the background first (optional)</button></div>);
  return (
    <div className="card question">
      <div className="pills">
        {card.country && <span className="pill teal">{card.country}</span>}
        {card.window && <span className="pill">Resolves by {card.window.to}</span>}
        {revise && <span className="pill indigo">Round 2 · revision</span>}
      </div>
      <h3>{card.statement}</h3>
      {revise
        ? <>{describeRelease(card.release)}{first != null && <p className="muted">Your first answer was {pct(first)}. You may revise it.</p>}</>
        : <p className="callout">Nothing is filled in for you. Move the slider or type a number from 1 to 99: 1 means almost certainly not, 99 means almost certainly yes.</p>}
      {blocked ? <div className="msg warn">{blocked}</div> : (
        <>
          {revise && card.thread?.available && <Thread api={api} card={card} mode={mode} />}
          {lookBlock}
          {lookError && <div className="msg err" role="alert">{lookError}</div>}
          <div className="estimate">
            <div className="estimate-head">
              <span className="what">Your estimate</span>
              <div className="readout-wrap">
                <output className={`big${valid ? '' : ' empty'}`} htmlFor={`s-${card.id}`}>{valid ? `${value}%` : '—'}</output>
                <div className="verbal">{valid ? verbal(/** @type {number} */ (value)) : 'Move the slider to answer'}</div>
              </div>
            </div>
            <input type="range" id={`s-${card.id}`} min={1} max={99} step={1} value={value ?? 50} disabled={done}
              className={value == null ? 'untouched' : undefined}
              style={/** @type {any} */ ({ '--pct': `${((value ?? 50) - 1) / 98 * 100}%` })}
              aria-label="Your probability that this happens"
              onChange={(e) => setValue(Number(e.target.value))}
              // A tap exactly on the resting thumb fires no change event, so a pointer release counts as choosing it.
              // Keys do not need this: every arrow, Home, End and Page key moves the thumb and fires a change.
              // (A key-up handler would record 50 as an answer just from tabbing into the slider.)
              onPointerUp={(e) => { if (value == null) setValue(Number(e.currentTarget.value)); }} />
            <div className="scale"><span>Unlikely</span><span>Toss-up</span><span>Likely</span></div>
            <div className="typed">
              <label htmlFor={`n-${card.id}`} className="plain">Or type it (1–99)</label>
              <input type="number" id={`n-${card.id}`} min={1} max={99} step={1} inputMode="numeric" disabled={done}
                value={value ?? ''} onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))} />
            </div>
          </div>
          {value != null && !valid && <div className="msg warn" role="alert">Use a whole number from 1 to 99.</div>}
          <div className="row">
            {done ? <button type="button" className="secondary" onClick={onNext}>Next question</button>
              : revise
                ? <>
                  {/* Equal weight on purpose: both are the same plain button, and both need the first answer to be known. */}
                  <button type="button" disabled={busy || first == null} onClick={() => save(first)}>Keep my first answer</button>
                  <button type="button" disabled={busy || first == null || !valid} onClick={submit}>Save my revision</button>
                </>
                : <button type="button" disabled={busy || !valid} onClick={submit}>Submit</button>}
          </div>
        </>
      )}
      {state.text && <div className={`msg ${state.phase === 'error' ? 'err' : state.phase === 'queued' ? 'warn' : 'ok'}`} role={state.phase === 'error' ? 'alert' : 'status'}>{state.text}</div>}
      <Objection api={api} card={card} />
    </div>
  );
}
