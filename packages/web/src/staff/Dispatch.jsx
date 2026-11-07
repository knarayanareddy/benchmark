import { useRef, useState } from 'react';
import { useLoad, problems } from './hooks.js';
import { BANDS } from './Cards.jsx';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';
import { Timeline } from '../components/Timeline.jsx';
import '../dispatch.css';

/** @typedef {import('../lib/api.js').Api} Api */

const DECISION = { ask: 'Asked', radar: 'On their radar', outside: 'Outside what they cover', answered: 'Already answered' };
const DECISION_CLASS = { ask: 'teal', radar: 'indigo', outside: '', answered: 'amber' };
const LEVEL = { identified: 'Identified', pseudonymous: 'Pseudonymous', anonymous: 'Anonymous' };
const or = (/** @type {string | null | undefined} */ v) => v || '—';

/**
 * The Cards form takes a region only from its vocabulary; anything else is left blank. The theme is never copied from the
 * risk: it routes the card to experts, so the moderator chooses it (an empty theme is Cards' "Not set").
 * @param {any} r
 */
function draftFrom(r) {
  return {
    riskId: r.id,
    riskTitle: r.title,
    country: r.isos?.[0] ?? '',
    region: REGIONS.includes(r.region) ? r.region : '',
    theme: '',
    probability: BANDS.includes(r.probability) ? r.probability : '',
  };
}

/** @param {{ api: Api, setDraft: (d: any) => void, goto: (tab: string) => void }} props */
function RiskBrowser({ api, setDraft, goto }) {
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [theme, setTheme] = useState('');
  // The unfiltered list loads once; a search replaces it.
  const all = useLoad(() => api('GET', '/api/risks'));
  const [found, setFound] = useState(/** @type {any[] | null} */ (null));
  const [searchError, setSearchError] = useState('');
  const [detail, setDetail] = useState(/** @type {any} */ (null));
  const [detailError, setDetailError] = useState('');
  const searchSeq = useRef(0);
  const pickSeq = useRef(0);
  const rows = found ?? all.data;
  const error = searchError || all.error;

  // Only the newest search and the newest pick may land, so a slow earlier response cannot overwrite them.
  async function search(/** @type {Record<string, string>} */ params) {
    const my = ++searchSeq.current;
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    try {
      const r = await api('GET', `/api/risks${qs ? `?${qs}` : ''}`);
      if (my === searchSeq.current) { setFound(r); setSearchError(''); }
    } catch (e) { if (my === searchSeq.current) setSearchError(problems(e)); }
  }

  async function pick(/** @type {string} */ id) {
    const my = ++pickSeq.current;
    setDetail(null); setDetailError('');
    try {
      const r = await api('GET', `/api/risks/${encodeURIComponent(id)}`);
      if (my === pickSeq.current) setDetail(r);
    } catch (e) { if (my === pickSeq.current) setDetailError(problems(e)); }
  }

  return (
    <section>
      <h2>Pick a risk</h2>
      <form className="risk-search" onSubmit={(e) => { e.preventDefault(); search({ q: q.trim(), region, theme }); }}>
        <div className="field"><label htmlFor="risk-q">Search risks</label><input id="risk-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="risk-region">Region</label><select id="risk-region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">Any region</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="field"><label htmlFor="risk-theme">Theme</label><select id="risk-theme" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="">Any theme</option>{Object.entries(THEMES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
        <div className="row"><button type="submit">Search</button></div>
      </form>
      {error && <div className="msg err" role="alert">{error}</div>}
      {rows && (rows.length
        ? (
          <ul className="dsp-risk-list">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" className={`dsp-risk-row${detail?.id === r.id ? ' on' : ''}`} aria-pressed={detail?.id === r.id} onClick={() => pick(r.id)}>
                  <strong>{r.title}</strong>
                  <span className="muted">{r.country}</span>
                  <span className="pills">
                    {r.region && <span className="pill">{r.region}</span>}
                    {r.theme && <span className="pill">{THEMES[r.theme] ?? r.theme}</span>}
                    {r.hasQuestion && <span className="pill amber">Open question</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
        : <p className="muted">No risks match.</p>)}
      {detailError && <div className="msg err" role="alert">{detailError}</div>}
      {detail && (
        <div className="card dsp-risk-detail">
          <h3>{detail.title}</h3>
          <p className="muted">{detail.country}{detail.region ? `, ${detail.region}` : ''}</p>
          <dl className="dsp-risk-facts">
            <dt>Type</dt><dd>{or(detail.riskType)}</dd>
            <dt>Status</dt><dd>{or(detail.status)}</dd>
            <dt>Level</dt><dd>{or(detail.level)}</dd>
            <dt>Probability</dt><dd>{or(detail.probability)}</dd>
            <dt>Impact</dt><dd>{or(detail.impact)}</dd>
            <dt>Rationale</dt><dd>{or(detail.rationale)}</dd>
            <dt>Triggers</dt>
            <dd>{detail.triggers?.length
              ? <ul>{detail.triggers.map((/** @type {any} */ t) => <li key={t.id}><strong>{t.title}</strong>{t.description ? ` ${t.description}` : ''}</li>)}</ul>
              : 'None recorded.'}
            </dd>
          </dl>
          {detail.timeline && <Timeline timeline={detail.timeline} />}
          <div className="row">
            <button type="button" onClick={() => { setDraft(draftFrom(detail)); goto('cards'); }}>Draft a card from this risk</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** @param {{ api: Api, draft: any }} props */
function DispatchPreview({ api, draft }) {
  const cards = useLoad(() => api('GET', '/api/staff/cards'));
  const [cardId, setCardId] = useState('');
  const [country, setCountry] = useState(draft?.country ?? '');
  const [region, setRegion] = useState(draft?.region ?? '');
  const [theme, setTheme] = useState(draft?.theme ?? '');
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const seq = useRef(0);

  async function run(e) {
    e.preventDefault();
    const my = ++seq.current;
    // Exactly one of cardId and draft is sent: an existing card wins over the draft fields.
    const body = cardId ? { cardId } : { draft: { country: country.trim(), region: region || undefined, theme: theme || undefined } };
    try {
      const r = await api('POST', '/api/staff/dispatch/preview', body);
      if (my === seq.current) { setResult(r); setError(''); }
    } catch (err) { if (my === seq.current) { setResult(null); setError(problems(err)); } }
  }

  const counts = result?.counts;
  return (
    <section>
      <h2>Preview who would be asked</h2>
      <p className="muted">Anonymous experts appear only as “Anonymous expert”, and “already answered” is never checked for them, so their rows show only what their declaration would offer.</p>
      <form onSubmit={run}>
        <div className="form-grid">
          <div className="field"><label htmlFor="pv-card">Existing card</label><select id="pv-card" value={cardId} onChange={(e) => setCardId(e.target.value)}><option value="">None: use the draft fields below</option>{(cards.data ?? []).map((/** @type {any} */ c) => <option key={c.id} value={c.id}>{`${c.id}: ${c.statement}`}</option>)}</select></div>
          <div className="field"><label htmlFor="pv-country">Country (ISO code)</label><input id="pv-country" type="text" value={country} disabled={!!cardId} onChange={(e) => setCountry(e.target.value)} /></div>
          <div className="field"><label htmlFor="pv-region">Region (optional)</label><select id="pv-region" value={region} disabled={!!cardId} onChange={(e) => setRegion(e.target.value)}><option value="">Any region</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="field"><label htmlFor="pv-theme">Theme (optional)</label><select id="pv-theme" value={theme} disabled={!!cardId} onChange={(e) => setTheme(e.target.value)}><option value="">Any theme</option>{Object.entries(THEMES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
        </div>
        <div className="row"><button type="submit">Preview</button></div>
      </form>
      {cards.error && <div className="msg err" role="alert">{cards.error}</div>}
      {error && <div className="msg err" role="alert">{error}</div>}
      {result && counts && (
        <>
          <p role="status">{`Would be asked: ${counts.ask}. On radar, not pushed: ${counts.radar}. Outside what they cover: ${counts.outside}. Already answered: ${counts.answered}.`}</p>
          {result.rows.length
            ? (
              <table className="stack">
                <thead><tr><th>Expert</th><th>Level</th><th>Reasons</th><th>Decision</th></tr></thead>
                <tbody>
                  {result.rows.map((/** @type {any} */ r, i) => (
                    <tr key={i}>
                      <td><strong>{r.label}</strong></td>
                      <td><span className="pill">{LEVEL[r.level] ?? or(r.level)}</span></td>
                      <td>{r.why.length ? r.why.map((/** @type {any} */ w, j) => <span key={j} className="pill">{w.label}</span>) : null}{note(r) && <span className="muted">{note(r)}</span>}</td>
                      <td><span className={`pill ${DECISION_CLASS[/** @type {keyof typeof DECISION_CLASS} */ (r.decision)] ?? ''}`}>{DECISION[/** @type {keyof typeof DECISION} */ (r.decision)] ?? r.decision}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
            : <p className="muted">No experts in the panel yet.</p>}
        </>
      )}
    </section>
  );
}

/** The chips already say why; the text adds only what they do not: the cap or age note, or the whole reason when there are no chips. */
const note = (/** @type {any} */ r) => (r.why.length ? (/\(([^)]+)\)\s*$/.exec(r.reason ?? '')?.[1] ?? null) : (r.reason || null));

/**
 * The staff Dispatch tab: find a risk and draft a card from it, then preview who would be asked.
 * @param {{ api: Api, me: { id: string, role: string }, draft?: any, setDraft?: (d: any) => void, goto?: (tab: string) => void }} props
 */
export function Dispatch({ api, draft = null, setDraft = () => {}, goto = () => {} }) {
  return (
    <>
      <RiskBrowser api={api} setDraft={setDraft} goto={goto} />
      <DispatchPreview api={api} draft={draft} />
    </>
  );
}
