import { useEffect, useMemo, useState } from 'react';
import { asErr } from '../lib/api.js';
import { sendEstimate } from '../lib/send.js';
import { enqueue } from '../lib/queue.js';
import { obtainBallot } from '../lib/device.js';
import { anonymous } from '../lib/send.js';
import { SecondLook } from './SecondLook.jsx';
import { Picture } from './Picture.jsx';
import { Thread } from './Thread.jsx';
import { ChipGroup } from '../components/ChipGroup.jsx';
import { identifyingHints, LEVEL_COPY } from '@benchmark/core/anonymity';
import { THEMES } from '@benchmark/core/taxonomy';
import '../question.css';

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

const CONFIDENCE = [{ value: '1', label: 'Hunch' }, { value: '2', label: 'Fairly sure' }, { value: '3', label: 'Very sure' }];
const BASIS = [
  { value: 'none', label: 'Judgement only' }, { value: 'direct', label: 'I saw / heard it directly' },
  { value: 'local_source', label: 'Trusted local source' }, { value: 'data', label: 'Data or monitoring' },
  { value: 'analysis', label: 'Analysis / literature' },
];
const REASON_MAX = 600;

/** The anonymity level is one per account, so this is shown, not chosen. Fetched once and remembered. */
let levelCache = /** @type {Promise<string | null> | null} */ (null);
/** @param {any} api @returns {Promise<string | null>} */
const levelOf = (api) => {
  const have = levelCache;
  if (have) return have;
  const fresh = /** @type {Promise<string | null>} */ (api('GET', '/api/me/profile').then((/** @type {any} */ p) => p?.level ?? null).catch(() => { levelCache = null; return null; }));
  levelCache = fresh;
  return fresh;
};
export const resetLevelCache = () => { levelCache = null; };

/** Where, and by whom, the question will be settled. The first thing a forecaster needs. */
function Resolution({ card }) {
  const r = card.resolution;
  if (!r && !card.window) return null;
  return (
    <details className="resolution">
      <summary>How this will be resolved</summary>
      {r?.objective && <p><strong>It counts as “yes” if:</strong> {r.objective}</p>}
      {r?.source && <p><strong>Checked against:</strong> {r.source}{r.resolver ? ` · decided by ${r.resolver}` : ''}</p>}
      {card.window && <p><strong>Window:</strong> {card.window.from} to {card.window.to}</p>}
    </details>
  );
}

const KINDS = [
  ['two_risks', 'This is really two questions'], ['window', 'The time window is wrong'],
  ['already_happening', 'This has already happened'], ['intent_not_condition', 'This is about intent, not something observable'],
];

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
  const [revised, setRevised] = useState(/** @type {number | null} */ (null)); // percent, once a revision is saved
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
  // Optional context that rides with a first answer: how sure, why, on what basis, any stake in the outcome.
  const [confidence, setConfidence] = useState('');
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState('none');
  const [coi, setCoi] = useState(false);
  const [level, setLevel] = useState(/** @type {string | null} */ (null));
  const shownLevel = mode === 'device' ? 'anonymous' : level;
  const hints = useMemo(() => identifyingHints(reason), [reason]);
  useEffect(() => {
    if (revise) return undefined;
    // A device-held key is always Anonymous, so it needs no login call just to say so (see `shownLevel`).
    if (mode === 'device') return undefined;
    let live = true;
    levelOf(api).then((l) => { if (live) setLevel(l); });
    return () => { live = false; };
  }, [api, revise, mode]);

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
  async function save(p, context = {}, asRevision = false) {
    setState({ phase: 'saving', text: '' });
    try {
      const r = await sendEstimate(api, mode, card.id, p, context);
      if (asRevision) setRevised(Math.round(r.p * 100));
      setState({ phase: 'saved', text: `Saved: ${pct(r.p)}${r.clamped ? ' (kept within 1–99%)' : ''}. Thank you.` });
    } catch (e) {
      const err = asErr(e);
      if (err.offline) {
        await enqueue(card.id, p, context);
        setState({ phase: 'queued', text: 'You are offline. Your answer is saved on this phone and will be sent when you are back online.' });
        onQueued?.();
      } else setState({ phase: 'error', text: err.message });
    }
  }
  /** Only what the person actually said is sent, so an answer with nothing extra looks exactly as it always did. */
  function contextBody() {
    if (revise) return {};
    const c = /** @type {Record<string, any>} */ ({});
    if (confidence) c.confidence = Number(confidence);
    if (reason.trim()) c.reason = reason.trim();
    if (basis !== 'none') c.evidenceType = basis;
    if (coi) c.coi = true;
    return c;
  }
  async function submit() {
    if (!valid) return;
    if ([...reason].length > REASON_MAX) return;
    await save(/** @type {number} */ (value) / 100, contextBody(), revise);
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
        {card.theme && <span className="pill">{THEMES[card.theme] ?? card.theme}</span>}
        {revise ? <span className="pill indigo">Round 2 · revision</span> : <span className="pill indigo">Risk question</span>}
        {!revise && <span className="muted q-time">Takes about 90 seconds</span>}
      </div>
      <h3>{card.statement}</h3>
      <Resolution card={card} />
      {revise
        ? card.round === 2 && <Picture acaps={card.acaps} release={card.release} mine={first} revised={revised} />
        : <p className="callout">🔒 Blind round: ACAPS’s rating and the circle’s views are hidden until you answer. Nothing is filled in for you: move the slider or type a number from 1 to 99.</p>}
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
          {!revise && !done && (
            <div className="q-context">
              <h4>How sure are you?</h4>
              <ChipGroup label="How sure are you?" options={CONFIDENCE} value={confidence} onChange={setConfidence} />
              <label htmlFor={`why-${card.id}`}>Why? <span className="muted">(optional, a sentence is plenty)</span></label>
              <textarea id={`why-${card.id}`} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="What are you seeing that a report may not?" aria-describedby={`why-note-${card.id}`} />
              <p id={`why-note-${card.id}`} className="muted">{[...reason].length} of {REASON_MAX}. Say what you see, not who you are. Email addresses and phone numbers are removed automatically.</p>
              {hints.length > 0 && (
                <div className="msg warn" role="status">
                  This could point to you or someone else: {hints.map((h) => `“${h.match}”`).join(', ')}. Consider describing the role or the place in general terms.
                </div>
              )}
              <h4>What is this based on?</h4>
              <ChipGroup label="What is this based on?" options={BASIS} value={basis} onChange={(v) => setBasis(v || 'none')} />
              <label className="plain q-coi">
                <input type="checkbox" checked={coi} onChange={(e) => setCoi(e.target.checked)} />
                <span>This outcome affects my organisation’s funding or position. <span className="muted">We record this so the analysis can check whether it matters. It never penalises you or changes anyone’s weight.</span></span>
              </label>
              {shownLevel && LEVEL_COPY[shownLevel] && (
                <div className="q-identity">
                  <p><strong>This will be shown as: {LEVEL_COPY[shownLevel].label}</strong></p>
                  <p className="muted">{LEVEL_COPY[shownLevel].toPeers}</p>
                  <p className="muted">This applies to everything you contribute. You can read what each level means in My data.</p>
                </div>
              )}
            </div>
          )}
          <div className="row">
            {done ? <button type="button" className="secondary" onClick={onNext}>Next question</button>
              : revise
                ? <>
                  {/* Equal weight on purpose: both are the same plain button, and both need the first answer to be known. */}
                  <button type="button" disabled={busy || first == null} onClick={() => save(first)}>Keep my first answer</button>
                  <button type="button" disabled={busy || first == null || !valid} onClick={submit}>Save my revision</button>
                </>
                : <button type="button" className="lock" disabled={busy || !valid} onClick={submit}>Lock in my estimate</button>}
          </div>
        </>
      )}
      {!revise && !done && card.window && <p className="muted q-foot">Resolves {card.window.to}. Your first estimate is locked; you may revise it in the second round.</p>}
      {state.text && <div className={`msg ${state.phase === 'error' ? 'err' : state.phase === 'queued' ? 'warn' : 'ok'}`} role={state.phase === 'error' ? 'alert' : 'status'}>{state.text}</div>}
      <Objection api={api} card={card} />
    </div>
  );
}
