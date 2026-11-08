import { useMemo, useRef, useState } from 'react';
import { useLoad, problems } from './hooks.js';
import { THEMES } from '@benchmark/core/taxonomy';
import '../evolution.css';

/** @typedef {import('../lib/api.js').Api} Api */

const TEXT_MIN = 20;
const TEXT_MAX = 500;
const MIN_CELL = 10;

/** A probability in [0, 1] as a percentage, one decimal at most. */
const pct = (/** @type {number} */ p) => `${Math.round(p * 1000) / 10}%`;
const clamp01 = (/** @type {number} */ p) => Math.min(1, Math.max(0, p));
const themeLabel = (/** @type {string} */ k) => THEMES[/** @type {keyof typeof THEMES} */ (k)] ?? k;

/**
 * Every link reachable from `cardId` in at most `maxDepth` steps. A card is reached once, at its shortest depth, so a cycle ends.
 * @param {Array<{ fromCardId: string, toCardId: string, mechanism: string }>} links
 * @param {string} cardId
 * @param {number} [maxDepth]
 * @returns {Array<{ cardId: string, depth: number, via: string, mechanism: string }>}
 */
function downstream(links, cardId, maxDepth = 3) {
  const out = [];
  const seen = new Set([cardId]);
  let frontier = [cardId];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const from of frontier) {
      for (const l of links) {
        if (l.fromCardId !== from || seen.has(l.toCardId)) continue;
        seen.add(l.toCardId);
        out.push({ cardId: l.toCardId, depth, via: from, mechanism: l.mechanism });
        next.push(l.toCardId);
      }
    }
    frontier = next;
  }
  return out;
}

/** A small interval bar: the range from lo to hi with the estimate marked. The numbers are in the text beside it. */
function IntervalBar({ lo, hi, estimate }) {
  const w = 120;
  return (
    <svg className="ev-bar" viewBox={`0 0 ${w} 14`} aria-hidden="true" focusable="false">
      <line className="ev-bar-track" x1={0} x2={w} y1={7} y2={7} />
      <line className="ev-bar-range" x1={clamp01(lo) * w} x2={clamp01(hi) * w} y1={7} y2={7} />
      <circle className="ev-bar-point" cx={clamp01(estimate) * w} cy={7} r={3.5} />
    </svg>
  );
}

/** @param {{ api: Api, cards: any[] }} props */
function Panel({ api, cards }) {
  const [cardId, setCardId] = useState('');
  const [series, setSeries] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const seq = useRef(0);

  // Only the newest choice may land, so a slow earlier card cannot replace the one on screen.
  async function choose(/** @type {string} */ id) {
    const my = ++seq.current;
    setCardId(id); setSeries(null); setError('');
    if (!id) return;
    try {
      const r = await api('GET', `/api/staff/cards/${encodeURIComponent(id)}/series`);
      if (my === seq.current) setSeries(r);
    } catch (e) { if (my === seq.current) setError(problems(e)); }
  }

  const rows = series
    ? [
      ...series.points.map((/** @type {any} */ p) => ({ ...p, withheld: false })),
      ...series.withheld.map((/** @type {any} */ w) => ({ round: w.round, withheld: true })),
    ].sort((a, b) => a.round - b.round)
    : [];

  return (
    <section aria-labelledby="ev-panel-h">
      <h2 id="ev-panel-h">Panel over the rounds</h2>
      <p className="muted">Each round with its estimate and interval. A round with fewer than 5 respondents is withheld and shows no numbers.</p>
      <div className="field ev-select">
        <label htmlFor="ev-card">Card</label>
        <select id="ev-card" value={cardId} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose a card</option>
          {cards.map((c) => <option key={c.id} value={c.id}>{`${c.id}: ${c.statement}`}</option>)}
        </select>
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      {series && (
        <>
          <h3>{series.statement}</h3>
          <p className="muted">{`Status: ${series.status}`}</p>
          {rows.length === 0
            ? <p className="muted">No rounds to show yet.</p>
            : (
              <table className="stack" aria-label="Rounds for this card">
                <thead><tr><th scope="col">Round</th><th scope="col">Day</th><th scope="col">Experts</th><th scope="col">Estimate and interval</th></tr></thead>
                <tbody>
                  {rows.map((r) => r.withheld
                    ? <tr key={`w${r.round}`} className="ev-withheld"><td colSpan={4}>{`Round ${r.round}: withheld, fewer than 5 respondents`}</td></tr>
                    : (
                      <tr key={r.round}>
                        <td>{`Round ${r.round}`}</td>
                        <td>{r.day}</td>
                        <td>{`${r.n} experts`}</td>
                        <td>
                          <strong>{pct(r.estimate)}</strong>{' '}
                          <span className="muted">{`interval ${pct(r.lo)} to ${pct(r.hi)}`}</span>
                          <IntervalBar lo={r.lo} hi={r.hi} estimate={r.estimate} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          {series.note && <p className="muted">{series.note}</p>}
        </>
      )}
    </section>
  );
}

/** @param {{ grid: any }} props */
function Grid({ grid }) {
  const cell = (/** @type {string} */ region, /** @type {string} */ theme) => grid.cells.find((/** @type {any} */ c) => c.region === region && c.theme === theme);
  return (
    <>
      <p className="muted">{`Cells with fewer than ${grid.minCell ?? MIN_CELL} risks are descriptive only; no association is implied.`}</p>
      <div className="ev-scroll" role="region" aria-label="Regional grid, scrolls sideways on a small screen" tabIndex={0}>
      <table className="ev-grid" aria-label="Risks and cards by region and theme">
        <thead>
          <tr><th scope="col">Region</th>{grid.themes.map((/** @type {string} */ t) => <th key={t} scope="col">{themeLabel(t)}</th>)}</tr>
        </thead>
        <tbody>
          {grid.regions.map((/** @type {string} */ r) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {grid.themes.map((/** @type {string} */ t) => {
                const c = cell(r, t);
                return (
                  <td key={t} className={c?.small ? 'ev-small' : undefined} title={c?.small ? 'descriptive only' : undefined}>
                    {!c
                      ? '—'
                      : (
                        <>
                          <span>{`${c.risks} ${c.risks === 1 ? 'risk' : 'risks'}`}</span>
                          {c.cards > 0 && <span>{`${c.cards} ${c.cards === 1 ? 'card' : 'cards'} (${c.live} live)`}</span>}
                          {c.small && <span className="pill">descriptive only</span>}
                        </>
                      )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

/** The mechanism of the link a step follows: inline when short, in a details element when long. */
function Mechanism({ text }) {
  if (text.length <= 80) return <p className="muted">{`Mechanism: ${text}`}</p>;
  return (
    <details>
      <summary>Mechanism</summary>
      <p>{text}</p>
    </details>
  );
}

/**
 * The analyst links: read by every staff member, created and removed by moderators only.
 * @param {{ api: Api, moderator: boolean, cards: any[], links: { data: any, error: string, reload: () => Promise<void> } }} props
 */
function Links({ api, moderator, cards, links }) {
  const list = useMemo(() => /** @type {any[]} */ (links.data ?? []), [links.data]);
  const [removing, setRemoving] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mechanism, setMechanism] = useState('');
  const [rival, setRival] = useState('');
  const [formError, setFormError] = useState('');
  const [formOk, setFormOk] = useState('');
  const [chainCard, setChainCard] = useState('');
  const [chainOpen, setChainOpen] = useState(false);

  const statements = useMemo(() => {
    const m = new Map();
    for (const c of cards) m.set(c.id, c.statement);
    for (const l of list) { m.set(l.fromCardId, l.fromStatement); m.set(l.toCardId, l.toStatement); }
    return m;
  }, [cards, list]);
  const label = (/** @type {string} */ id) => statements.get(id) ?? id;
  const chain = chainOpen && chainCard ? downstream(list, chainCard) : [];

  async function create(/** @type {import('react').FormEvent} */ e) {
    e.preventDefault();
    const m = mechanism.trim();
    const r = rival.trim();
    const issues = [];
    if (!from || !to) issues.push('Choose the card the link comes from and the card it leads to.');
    else if (from === to) issues.push('Choose two different cards.');
    if (m.length < TEXT_MIN || m.length > TEXT_MAX) issues.push(`The mechanism needs ${TEXT_MIN} to ${TEXT_MAX} characters; it has ${m.length}.`);
    if (r.length < TEXT_MIN || r.length > TEXT_MAX) issues.push(`The rival explanation needs ${TEXT_MIN} to ${TEXT_MAX} characters; it has ${r.length}.`);
    setFormOk('');
    if (issues.length) { setFormError(issues.join(' ')); return; }
    setFormError('');
    try {
      await api('POST', '/api/staff/links', { fromCardId: from, toCardId: to, mechanism: m, rival: r });
      setFrom(''); setTo(''); setMechanism(''); setRival('');
      setFormOk('Link recorded.');
      await links.reload();
    } catch (err) { setFormError(problems(err)); }
  }

  async function remove(/** @type {string} */ id) {
    setRemoveError('');
    try {
      await api('DELETE', `/api/staff/links/${encodeURIComponent(id)}`);
      await links.reload();
    } catch (err) { setRemoveError(problems(err)); }
    setRemoving('');
  }

  const cardOptions = cards.map((c) => <option key={c.id} value={c.id}>{`${c.id}: ${c.statement}`}</option>);

  return (
    <section aria-labelledby="ev-links-h">
      <h2 id="ev-links-h">Linked questions (analyst judgement)</h2>
      <p className="muted">A link says one question may bear on another, by the mechanism stated and against the rival explanation. A link is not a finding, and nothing is linked automatically.</p>
      {links.error && <div className="msg err" role="alert">{links.error}</div>}
      {removeError && <div className="msg err" role="alert">{removeError}</div>}
      {!links.data && !links.error && <p>Loading…</p>}
      {links.data && list.length === 0 && <p className="muted">No links recorded yet.</p>}
      <ul>
        {list.map((l) => (
          <li key={l.id} className="card ev-link">
            <p><span className="pill amber">Analyst judgement, not a finding</span></p>
            <p><strong>From:</strong> {l.fromStatement}</p>
            <p><strong>To:</strong> {l.toStatement}</p>
            <p><strong>Mechanism:</strong> {l.mechanism}</p>
            <p><strong>Rival explanation:</strong> {l.rival}</p>
            <p className="muted">{`Recorded by ${l.by} on ${l.day}`}</p>
            {moderator && (removing === l.id
              ? (
                <div className="ev-confirm">
                  <span>Remove this link?</span>
                  <button type="button" className="danger" onClick={() => remove(l.id)}>Yes, remove this link</button>
                  <button type="button" className="secondary" onClick={() => setRemoving('')}>Keep it</button>
                </div>
              )
              : <button type="button" className="secondary" onClick={() => setRemoving(l.id)}>Remove link</button>)}
          </li>
        ))}
      </ul>

      <div className="card">
        <h3>Downstream of a card <span className="pill amber">Analyst judgement, not a finding</span></h3>
        <p className="muted">Follows the links as recorded, up to three steps.</p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ev-chain-card">Card to follow</label>
            <select id="ev-chain-card" value={chainCard} onChange={(e) => setChainCard(e.target.value)}>
              <option value="">Choose a card</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{`${c.id}: ${c.statement}`}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <button type="button" className="secondary" aria-expanded={chainOpen} disabled={!chainCard} onClick={() => setChainOpen(!chainOpen)}>
            {chainOpen ? 'Hide downstream' : 'Show downstream'}
          </button>
        </div>
        {chainOpen && chainCard && (chain.length === 0
          ? <p className="muted">No links lead on from this card.</p>
          : (
            <ol className="ev-chain">
              {chain.map((c) => (
                <li key={c.cardId}>
                  <p>{`Step ${c.depth}: ${label(c.cardId)}, after ${label(c.via)}`}</p>
                  <Mechanism text={c.mechanism} />
                </li>
              ))}
            </ol>
          ))}
      </div>

      {moderator && (
        <form className="ev-form card" onSubmit={create} noValidate aria-labelledby="ev-new-h">
          <h3 id="ev-new-h">Record a link</h3>
          <p className="muted">Name the mechanism and a rival explanation. Both are required.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="lk-from">From card (required)</label>
              <select id="lk-from" required value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Choose a card</option>{cardOptions}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lk-to">To card (required)</label>
              <select id="lk-to" required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a card</option>{cardOptions}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="lk-mech">Mechanism (required)</label>
            <textarea id="lk-mech" required aria-describedby="lk-mech-count" value={mechanism} onChange={(e) => setMechanism(e.target.value)} />
            <p id="lk-mech-count" className="muted ev-counter">{`${mechanism.trim().length} of ${TEXT_MAX} characters; at least ${TEXT_MIN} needed.`}</p>
          </div>
          <div className="field">
            <label htmlFor="lk-rival">Rival explanation (required)</label>
            <textarea id="lk-rival" required aria-describedby="lk-rival-count" value={rival} onChange={(e) => setRival(e.target.value)} />
            <p id="lk-rival-count" className="muted ev-counter">{`${rival.trim().length} of ${TEXT_MAX} characters; at least ${TEXT_MIN} needed.`}</p>
          </div>
          {formError && <div className="msg err" role="alert">{formError}</div>}
          {formOk && <div className="msg ok" role="status">{formOk}</div>}
          <div className="row"><button type="submit">Record link</button></div>
        </form>
      )}
    </section>
  );
}

/**
 * The staff Evolution tab: the panel over the rounds, the regional grid, and the analyst links.
 * @param {{ api: Api, me: { id: string, role: string } }} props
 */
export function Evolution({ api, me }) {
  const cards = useLoad(() => api('GET', '/api/staff/cards'));
  const grid = useLoad(() => api('GET', '/api/staff/evolution/grid'));
  const links = useLoad(() => api('GET', '/api/staff/links'));
  return (
    <>
      {cards.error && <div className="msg err" role="alert">{cards.error}</div>}
      <Panel api={api} cards={cards.data ?? []} />
      <section aria-labelledby="ev-grid-h">
        <h2 id="ev-grid-h">Regional grid</h2>
        {grid.error && <div className="msg err" role="alert">{grid.error}</div>}
        {!grid.data && !grid.error && <p>Loading…</p>}
        {grid.data && <Grid grid={grid.data} />}
      </section>
      <Links api={api} moderator={me.role === 'moderator'} cards={cards.data ?? []} links={links} />
    </>
  );
}
