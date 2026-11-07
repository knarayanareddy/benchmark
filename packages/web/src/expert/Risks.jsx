import { useEffect, useRef, useState } from 'react';
import { asErr } from '../lib/api.js';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';
import { Timeline } from '../components/Timeline.jsx';
import '../pulse.css';

const LIMIT = 200;
const NEUTRAL = "ACAPS's analysis of this risk is hidden while there is an open question about it, so your answer is your own. You will see it once the question is resolved.";
const NEUTRAL_NO_QUESTION = "ACAPS's analysis of this risk is kept back until a question about it has been answered and resolved, so that nobody's answer is shaped by it.";

/** Only the filters that are set go on the query string. */
function riskPath({ q, region, theme, country }) {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (region) p.set('region', region);
  if (theme) p.set('theme', theme);
  if (country.trim()) p.set('country', country.trim().toUpperCase());
  const s = p.toString();
  return s ? `/api/risks?${s}` : '/api/risks';
}

/** A 401 sends the person back to sign in (when the parent can); anything else is shown as text. @param {unknown} e @param {(() => void) | undefined} onExpired */
function failure(e, onExpired) {
  const err = asErr(e);
  if (err.status === 401 && onExpired) { onExpired(); return ''; }
  return err.offline ? 'You are offline. Try again when you are back online.' : err.message;
}

/** @param {{ risk: any }} props */
function Pills({ risk }) {
  return (
    <div className="pills">
      {risk.country && <span className="pill teal">{risk.country}</span>}
      {risk.region && <span className="pill">{risk.region}</span>}
      {risk.theme && <span className="pill">{THEMES[/** @type {keyof typeof THEMES} */ (risk.theme)] ?? risk.theme}</span>}
      {risk.hasQuestion && <span className="pill amber">Open question</span>}
    </div>
  );
}

/** @param {unknown} value */
const dash = (value) => (value == null || value === '' ? '—' : String(value));

/**
 * The detail view. A neutral view (a risk with an open question) renders the header only: restricted fields
 * are never read, so they cannot reach the document even if the payload carries them.
 * @param {{ risk: any, error: string, onBack: () => void }} props
 */
function Detail({ risk, error, onBack }) {
  return (
    <>
      <button type="button" className="secondary back" onClick={onBack}>Back to the list</button>
      {error && <div className="msg err" role="alert">{error}</div>}
      {!risk && !error && <p>Loading…</p>}
      {risk && (
        <article className="card question risk-detail">
          <Pills risk={risk} />
          <h2>{risk.title}</h2>
          {risk.view === 'neutral' ? (
            <>
              <p className="callout">{risk.hasQuestion ? NEUTRAL : NEUTRAL_NO_QUESTION}</p>
              <p className="muted">Type: {dash(risk.riskType)}</p>
            </>
          ) : (
            <>
              <dl className="risk-facts">
                <dt>Type</dt><dd>{dash(risk.riskType)}</dd>
                <dt>Status</dt><dd>{dash(risk.status)}</dd>
                <dt>Level</dt><dd>{dash(risk.level)}</dd>
                <dt>Probability</dt><dd>{dash(risk.probability)}</dd>
                <dt>Impact</dt><dd>{dash(risk.impact)}</dd>
              </dl>
              {risk.rationale && <><h3>Rationale</h3><p className="pre-wrap">{risk.rationale}</p></>}
              {risk.triggers?.length > 0 && (
                <>
                  <h3>Triggers</h3>
                  <ul>{risk.triggers.map((/** @type {any} */ t) => <li key={t.id ?? t.title}><strong>{t.title}</strong>{t.description ? ` ${t.description}` : ''}</li>)}</ul>
                </>
              )}
              {risk.timeline && <Timeline timeline={risk.timeline} />}
            </>
          )}
        </article>
      )}
    </>
  );
}

/** @param {{ api: import('../lib/api.js').Api, onExpired?: () => void }} props */
export function Risks({ api, onExpired }) {
  const [filters, setFilters] = useState({ q: '', region: '', theme: '', country: '' });
  const [list, setList] = useState(/** @type {any[] | null} */ (null));
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const [risk, setRisk] = useState(/** @type {any} */ (null));
  const [detailError, setDetailError] = useState('');
  const seq = useRef(0);

  // Typing is debounced; a superseded response is dropped, so the list always matches the filters on screen.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const rows = await api('GET', riskPath(filters));
        if (live) { setList(rows); setError(''); }
      } catch (e) { if (live) setError(failure(e, onExpired)); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [api, filters, onExpired]);

  const set = (/** @type {'q' | 'region' | 'theme' | 'country'} */ key) => (/** @type {{ target: { value: string } }} */ e) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  async function open(/** @type {string} */ id) {
    const mine = ++seq.current;
    setOpenId(id); setRisk(null); setDetailError('');
    try {
      const r = await api('GET', `/api/risks/${encodeURIComponent(id)}`);
      if (mine === seq.current) setRisk(r);
    } catch (e) { if (mine === seq.current) setDetailError(failure(e, onExpired)); }
  }

  if (openId) return <Detail risk={risk} error={detailError} onBack={() => { seq.current++; setOpenId(null); }} />;

  return (
    <>
      <h1 className="page-title">Risks</h1>
      <p className="page-sub">ACAPS&apos;s analysis of a risk is held back until a question about it has been asked and every question on it is resolved.</p>
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
      {error && <div className="msg err" role="alert">{error}</div>}
      {!list && !error && <p>Loading…</p>}
      {list && list.length === 0 && <p className="muted">No risks match these filters.</p>}
      {list && list.length > 0 && (
        <>
          <ul className="risk-list">
            {list.map((r) => (
              <li key={r.id} className="risk-row">
                <button type="button" className="secondary link risk-title" onClick={() => open(r.id)}>{r.title}</button>
                <Pills risk={r} />
              </li>
            ))}
          </ul>
          {list.length >= LIMIT && <p className="muted">Showing the first {LIMIT} risks. Narrow your search to see the others.</p>}
        </>
      )}
    </>
  );
}
