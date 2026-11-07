import { useEffect, useRef, useState } from 'react';
import { asErr } from '../lib/api.js';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';
import { MIN_RELEASE_PANEL_SIZE } from '@benchmark/core/aggregate';
import { Timeline } from '../components/Timeline.jsx';
import '../risks.css';

const LIMIT = 200;
const TABS = [{ view: 'active', label: 'Active' }, { view: 'history', label: 'History · how ACAPS did' }];

/**
 * The locked view, by the reason the server gives. Only the reason is read from the payload; the words are ours.
 * The prototype's sentences are kept; the ones that promised a button or an answer we cannot give are changed.
 */
const LOCK = {
  answer: {
    head: 'Locked until you give your own estimate',
    body: "Independence first: reading others' arguments before committing anchors everyone. It takes about 90 seconds.",
    how: 'If this question is put to you, answer it under Questions to unlock the analysis.',
    circle: 'Revealed after you give your own estimate.',
  },
  device: {
    head: 'Locked until you give your own estimate',
    body: "Independence first: reading others' arguments before committing anchors everyone. It takes about 90 seconds.",
    how: 'Your device holds your answers, so open the question to unlock this.',
    circle: 'Revealed after you give your own estimate.',
  },
  closed: {
    head: 'Locked until the question is resolved',
    body: 'A question on this risk has closed. Its analysis opens once it is resolved.',
    how: null,
    circle: 'Revealed once the question is resolved.',
  },
};

/** Only the filters that are set go on the query string. */
function riskPath({ q, region, theme, country }, view) {
  const p = new URLSearchParams({ view });
  if (q.trim()) p.set('q', q.trim());
  if (region) p.set('region', region);
  if (theme) p.set('theme', theme);
  if (country.trim()) p.set('country', country.trim().toUpperCase());
  return `/api/risks?${p}`;
}

/** A 401 sends the person back to sign in (when the parent can); anything else is shown as text. @param {unknown} e @param {(() => void) | undefined} onExpired */
function failure(e, onExpired) {
  const err = asErr(e);
  if (err.status === 401 && onExpired) { onExpired(); return ''; }
  return err.offline ? 'You are offline. Try again when you are back online.' : err.message;
}

/** @param {string | null | undefined} level */
const levelTone = (level) => (level === 'High' || level === 'Very High' ? 'rose' : level === 'Medium' ? 'amber' : '');
/** @param {string | null | undefined} status */
const statusTone = (status) => (status === 'Active' ? 'indigo' : status === 'Materialised' ? 'rose' : '');
/** @param {number} p a fraction 0..1 */
const pct = (p) => `${Math.round(p * 100)}%`;
/** @param {unknown} value */
const dash = (value) => (value == null || value === '' ? '—' : String(value));

/** The line under a list card: what the viewer can see about its questions. */
function listMeta(/** @type {any} */ r) {
  const n = r.liveQuestions ?? 0;
  if (n === 0) return 'No question open on this risk';
  return `${n} live ${n === 1 ? 'question' : 'questions'} · ${r.answered ? 'you answered' : 'answer to reveal'}`;
}

/**
 * The circle's figure for a risk's question, as the server releases it. Read only for a viewer who may see the
 * question's panel: a live question they answered, or a resolved one.
 * @param {{ api: import('../lib/api.js').Api, question: { id: number | string }, onExpired?: () => void }} props
 */
function Circle({ api, question, onExpired }) {
  const [state, setState] = useState(/** @type {{ status: 'loading' } | { status: 'ready', release: any } | { status: 'error', message: string }} */ ({ status: 'loading' }));
  // The parent keys this component by question id, so a new question starts in the loading state.
  useEffect(() => {
    let live = true;
    api('GET', `/api/cards/${encodeURIComponent(String(question.id))}/release`)
      .then((release) => { if (live) setState({ status: 'ready', release }); })
      .catch((e) => { if (live) setState({ status: 'error', message: failure(e, onExpired) || 'The circle view could not be loaded.' }); });
    return () => { live = false; };
  }, [api, question.id, onExpired]);
  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="msg err" role="alert">{state.message}</p>;
  const r = state.release;
  if (!r || r.suppressed || r.estimate == null) return <p className="muted">Hidden until ≥ {MIN_RELEASE_PANEL_SIZE} members answer.</p>;
  return <p className="circle-figure"><b>{pct(r.estimate)}</b> (Circle range {pct(r.lo)}–{pct(r.hi)}) · n={r.n}</p>;
}

/**
 * One risk. A locked view (the server says the analysis is held back) renders no analysis, trigger or status field:
 * they are never read from the payload, so they cannot reach the page even if it carries them.
 * @param {{ risk: any, api: import('../lib/api.js').Api, onExpired?: () => void }} props
 */
function RiskBody({ risk, api, onExpired }) {
  const full = risk.view === 'full';
  const lock = LOCK[/** @type {keyof typeof LOCK} */ (risk.lock)] ?? LOCK.answer;
  const triggers = full ? risk.triggers ?? [] : [];
  return (
    <>
      <div className="pills risk-head">
        {risk.country && <span className="pill teal">{risk.country}</span>}
        <span className="pill">{THEMES[/** @type {keyof typeof THEMES} */ (risk.theme)] ?? risk.theme}</span>
        <span className="pill">{risk.id}</span>
        {full && risk.level && <span className={`pill ${levelTone(risk.level)}`}>{risk.level} risk</span>}
        {full && risk.timeline?.riskTrend && <span className="pill">{risk.timeline.riskTrend}</span>}
        {full && risk.status && <span className={`pill ${statusTone(risk.status)}`}>{risk.status}</span>}
      </div>
      <h1 className="risk-h1">{risk.title}</h1>
      <div className="risk-layout">
        <div className="risk-col">
          {full ? (
            <section className="card">
              <h2 className="card-title">ACAPS analysis</h2>
              {risk.rationale && <p className="risk-rationale">{risk.rationale}</p>}
              <p className="muted">Probability: <b>{dash(risk.probability)}</b> · Impact: <b>{dash(risk.impact)}</b></p>
            </section>
          ) : (
            <section className="card risk-lock">
              <h2 className="card-title"><span aria-hidden="true">🔒 </span>{lock.head}</h2>
              <p className="muted">{lock.body}</p>
              {lock.how && <p>{lock.how}</p>}
            </section>
          )}
          {triggers.length > 0 && (
            <section className="card">
              <h2 className="card-title">Triggers for deterioration</h2>
              {triggers.map((/** @type {any} */ t) => (
                <div key={t.id ?? t.title} className="risk-trigger">
                  <div className="risk-trigger-title">{t.title}</div>
                  {t.description && <div className="muted">{t.description.slice(0, 220)}…</div>}
                </div>
              ))}
            </section>
          )}
          {risk.question && (
            <section className="card">
              <h2 className="card-title">Circle view</h2>
              {full ? <Circle key={risk.question.id} api={api} question={risk.question} onExpired={onExpired} /> : <p className="muted">{lock.circle}</p>}
            </section>
          )}
        </div>
      </div>
      {full && risk.timeline && <Timeline timeline={risk.timeline} />}
    </>
  );
}

/**
 * @param {{ risk: any, error: string, onBack: () => void, api: import('../lib/api.js').Api, onExpired?: () => void }} props
 */
function Detail({ risk, error, onBack, api, onExpired }) {
  return (
    <div className="risks">
      <button type="button" className="secondary link back" onClick={onBack}>← Risks</button>
      {error && <div className="msg err" role="alert">{error}</div>}
      {!risk && !error && <p>Loading…</p>}
      {risk && <RiskBody risk={risk} api={api} onExpired={onExpired} />}
    </div>
  );
}

/** @param {{ api: import('../lib/api.js').Api, onExpired?: () => void }} props */
export function Risks({ api, onExpired }) {
  const [view, setView] = useState(/** @type {'active' | 'history'} */ ('active'));
  const [filters, setFilters] = useState({ q: '', region: '', theme: '', country: '' });
  const [list, setList] = useState(/** @type {any[] | null} */ (null));
  const [error, setError] = useState('');
  const [counts, setCounts] = useState(/** @type {{ active: number | null, history: number | null }} */ ({ active: null, history: null }));
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const [risk, setRisk] = useState(/** @type {any} */ (null));
  const [detailError, setDetailError] = useState('');
  const seq = useRef(0);

  // The tab counts: each tab's own list with no filters. A failure leaves the label without a number.
  useEffect(() => {
    let live = true;
    Promise.all(['active', 'history'].map((v) => api('GET', `/api/risks?view=${v}`).then((rows) => rows.length, () => null)))
      .then(([active, history]) => { if (live) setCounts({ active, history }); });
    return () => { live = false; };
  }, [api]);

  // Typing is debounced; a superseded response is dropped, so the list always matches the filters and tab on screen.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const rows = await api('GET', riskPath(filters, view));
        if (live) { setList(rows); setError(''); }
      } catch (e) { if (live) setError(failure(e, onExpired)); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [api, filters, view, onExpired]);

  const set = (/** @type {'q' | 'region' | 'theme' | 'country'} */ key) => (/** @type {{ target: { value: string } }} */ e) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  function choose(/** @type {'active' | 'history'} */ next) {
    if (next === view) return;
    setList(null);
    setView(next);
  }

  async function open(/** @type {string} */ id) {
    const mine = ++seq.current;
    setOpenId(id); setRisk(null); setDetailError('');
    try {
      const r = await api('GET', `/api/risks/${encodeURIComponent(id)}`);
      if (mine === seq.current) setRisk(r);
    } catch (e) { if (mine === seq.current) setDetailError(failure(e, onExpired)); }
  }

  if (openId) return <Detail risk={risk} error={detailError} onBack={() => { seq.current++; setOpenId(null); }} api={api} onExpired={onExpired} />;

  return (
    <div className="risks">
      <h1 className="page-title">Risks &amp; the Roundtable</h1>
      <p className="page-sub">Every card is a real ACAPS Risk Radar entry. Circle numbers appear only after you&apos;ve answered — and only when at least {MIN_RELEASE_PANEL_SIZE} members have.</p>
      <div className="risks-bar">
        <div className="risks-toggle" role="group" aria-label="Which risks">
          {TABS.map((t) => (
            <button key={t.view} type="button" aria-pressed={view === t.view} className={view === t.view ? 'on' : ''} onClick={() => choose(/** @type {'active' | 'history'} */ (t.view))}>
              {t.label}{counts[/** @type {'active' | 'history'} */ (t.view)] == null ? '' : ` (${counts[/** @type {'active' | 'history'} */ (t.view)]})`}
            </button>
          ))}
        </div>
        <form role="search" className="risk-filters" onSubmit={(e) => e.preventDefault()}>
          <div className="field">
            <label htmlFor="risk-q">Search risks</label>
            <input id="risk-q" type="search" value={filters.q} onChange={set('q')} />
          </div>
          <div className="field">
            <label htmlFor="risk-region">Region</label>
            <select id="risk-region" value={filters.region} onChange={set('region')}>
              <option value="">All regions</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="risk-theme">Theme</label>
            <select id="risk-theme" value={filters.theme} onChange={set('theme')}>
              <option value="">All themes</option>
              {Object.entries(THEMES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="risk-country">Country (ISO3)</label>
            <input id="risk-country" type="text" maxLength={3} autoComplete="off" value={filters.country} onChange={set('country')} />
          </div>
        </form>
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      {!list && !error && <p>Loading…</p>}
      {list && list.length === 0 && <p className="muted">No risks match these filters.</p>}
      {list && list.length > 0 && (
        <>
          <ul className="risks-grid">
            {list.map((r) => (
              <li key={r.id}>
                <button type="button" className="risk-card" onClick={() => open(r.id)}>
                  <span className="pills">
                    {r.country && <span className="pill teal">{r.country}</span>}
                    {r.level && <span className={`pill ${levelTone(r.level)}`}>{r.level}</span>}
                    <span className="pill">{THEMES[/** @type {keyof typeof THEMES} */ (r.theme)] ?? r.theme}</span>
                    {view === 'history' && r.status && <span className={`pill ${r.status === 'Materialised' ? 'rose' : 'green'}`}>{r.status}</span>}
                  </span>
                  <span className="risk-card-title">{r.title}</span>
                  <span className="risk-card-meta">
                    {view === 'history' ? `ACAPS rated probability: ${r.probability || 'unrated'}` : listMeta(r)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list.length >= LIMIT && <p className="muted">Showing the first {LIMIT} risks. Narrow your search to see the others.</p>}
        </>
      )}
    </div>
  );
}
