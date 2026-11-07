import { el, api, notice, byId, asErr } from '/ui.js';

const call = api('bm.staff');
const main = byId('main');
const nav = byId('nav');
const SOURCES = ['ACLED', 'IPC', 'UNHCR', 'IMF', 'official_decree'];
const BANDS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];

for (const b of /** @type {NodeListOf<HTMLElement>} */ (nav.querySelectorAll('button[data-tab]'))) b.addEventListener('click', () => show(TABS[b.dataset.tab]));
byId('sign-out').addEventListener('click', () => { sessionStorage.clear(); location.hash = ''; location.reload(); });

async function show(view) {
  try { await view(); } catch (e) {
    if (asErr(e).status === 401) { sessionStorage.removeItem('bm.staff'); return signIn(); }
    main.replaceChildren(el('div', { class: 'msg err', role: 'alert' }, asErr(e).message));
  }
}

const field = (id, label, node) => [el('label', { for: id }, label), node];
const input = (id, type = 'text', extra = {}) => el('input', { id, type, ...extra });

function signIn() {
  nav.hidden = true;
  const status = el('div');
  const cred = input('cred', 'text', { autocomplete: 'off' });
  main.replaceChildren(el('section', {},
    el('h2', {}, 'Staff sign-in'),
    el('p', {}, 'Sign in with your organisation account.'),
    el('div', { class: 'row' }, el('a', { class: 'btn', href: '/api/staff/oidc/login' }, 'Sign in with SSO')),
    el('details', {}, el('summary', { class: 'muted' }, 'Pilot credential (only if SSO is not configured)'),
      ...field('cred', 'Credential', cred),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'secondary', onclick: async () => {
        try {
          const r = await call('POST', '/api/staff/session', { credential: cred.value });
          sessionStorage.setItem('bm.staff', r.sessionToken); show(cards);
        } catch (e) { notice(status, asErr(e).message, 'err'); }
      } }, 'Sign in'))),
    status));
}

// ── cards ───────────────────────────────────────────────────────────────
async function cards() {
  nav.hidden = false;
  const list = await call('GET', '/api/staff/cards');
  const status = el('div');
  const f = {
    statement: el('textarea', { id: 'statement' }), country: input('country'), region: input('region'), theme: input('theme'),
    from: input('from', 'date'), to: input('to', 'date'), objective: el('textarea', { id: 'objective' }),
    source: el('select', { id: 'source' }, SOURCES.map((s) => el('option', { value: s }, s))),
    resolver: input('resolver'), probability: el('select', { id: 'prob' }, BANDS.map((s) => el('option', { value: s, selected: s === 'Medium' }, s))),
  };
  const create = el('section', {},
    el('h2', {}, 'Author a card'),
    el('p', { class: 'muted' }, 'A card opens only with real dates, a written objective, an external source and a named resolver, fixed now and never at resolution.'),
    ...field('statement', 'Statement', f.statement), ...field('country', 'Country (ISO code)', f.country),
    ...field('region', 'Region (optional)', f.region), ...field('theme', 'Theme (optional)', f.theme),
    ...field('from', 'Window starts', f.from), ...field('to', 'Window ends', f.to),
    ...field('objective', 'Objective: what exactly counts as “yes”?', f.objective),
    ...field('source', 'Resolution source', f.source), ...field('resolver', 'Named resolver', f.resolver),
    ...field('prob', 'ACAPS probability rating (seeds the card)', f.probability),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: async () => {
      try {
        const r = await call('POST', '/api/staff/cards', {
          statement: f.statement.value, country: f.country.value, region: f.region.value || undefined, theme: f.theme.value || undefined,
          window: { from: f.from.value, to: f.to.value }, objective: f.objective.value, resolutionSource: f.source.value,
          resolver: f.resolver.value, probability: f.probability.value,
        });
        notice(status, `Created ${r.card.id}.${r.warnings.length ? ` Warnings: ${r.warnings.join('; ')}` : ''}`);
        show(cards);
      } catch (e) { notice(status, [asErr(e).message, ...(asErr(e).data?.problems || [])].join(' — '), 'err'); }
    } }, 'Create card')), status);

  const rows = list.map((c) => {
    const act = (label, fn) => el('button', { type: 'button', class: 'secondary', onclick: async () => {
      try { await fn(); show(cards); } catch (e) { alert(asErr(e).message); }
    } }, label);
    return el('tr', {},
      el('td', {}, el('strong', {}, c.id), el('br'), c.statement),
      el('td', {}, el('span', { class: 'tag' }, c.status), el('span', { class: 'tag' }, `round ${c.round}`), el('br'), `${c.responses} answers`),
      el('td', {},
        c.status === 'open' ? act('Close round', () => call('POST', `/api/staff/cards/${c.id}/close`)) : '',
        c.status === 'closed' && c.round === 1 ? act('Open round 2', () => call('POST', `/api/staff/cards/${c.id}/round2`)) : '',
        ['open', 'closed'].includes(c.status) ? act('Resolve', async () => {
          const outcome = prompt('Outcome: 1 (happened), 0 (did not), or unobservable');
          if (outcome === null) throw new Error('cancelled');
          const evidenceUrl = prompt('Evidence link (https://…)');
          await call('POST', `/api/staff/cards/${c.id}/resolve`, { outcome: outcome === 'unobservable' ? outcome : Number(outcome), evidenceUrl });
        }) : '',
        act('Panel result', async () => {
          const r = await call('GET', `/api/cards/${c.id}/release`);
          alert(r.suppressed ? `Withheld: ${r.reason || `needs at least ${r.needed} answers (has ${r.n})`}` : `${r.n} experts: ${Math.round(r.estimate * 100)}% (${Math.round(r.lo * 100)}–${Math.round(r.hi * 100)}%)`);
        })));
  });
  main.replaceChildren(
    el('section', {}, el('h2', {}, 'Cards'),
      list.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Card'), el('th', {}, 'State'), el('th', {}, 'Actions'))), el('tbody', {}, rows))
        : el('p', { class: 'muted' }, 'No cards yet.')),
    create);
}

// ── dissents ────────────────────────────────────────────────────────────
async function dissents() {
  nav.hidden = false;
  const list = await call('GET', '/api/staff/dissents');
  const items = list.filter((d) => d.status !== 'closed').map((d) => {
    const status = el('div');
    const stmts = el('textarea', { placeholder: 'New statement(s), one per line (rewrite: 1, split: 2 or more)' });
    const action = el('select', {}, ['rewrite', 'split', 'retire', 'resolve_early'].map((a) => el('option', { value: a }, a)));
    const run = (label, fn, cls = 'secondary') => el('button', { type: 'button', class: cls, onclick: async () => {
      try { await fn(); show(dissents); } catch (e) { notice(status, [asErr(e).message, ...(asErr(e).data?.problems || [])].join(' — '), 'err'); }
    } }, label);
    const v = d.version;
    return el('div', { class: 'card' },
      el('p', {}, el('span', { class: 'tag' }, d.status), el('span', { class: 'tag' }, d.kind), el('span', { class: 'tag' }, d.by), ` on ${d.cardId}`),
      el('p', {}, d.text || '(no text)'),
      el('div', { class: 'row' },
        d.status === 'open' ? run('Route to review', () => call('POST', `/api/staff/dissents/${d.id}/route`, { expectedVersion: v })) : '',
        d.status === 'routed' ? [action, stmts, run('Act', () => call('POST', `/api/staff/dissents/${d.id}/act`, {
          expectedVersion: v, action: action.value, title: stmts.value.split('\n')[0].slice(0, 80), statements: stmts.value.split('\n').map((s) => s.trim()).filter(Boolean),
        }), '')] : '',
        d.status === 'actioned' ? [run('Notify the expert', () => call('POST', `/api/staff/dissents/${d.id}/notify`, { expectedVersion: v })),
          run('Close', () => call('POST', `/api/staff/dissents/${d.id}/close`, { expectedVersion: v, reason: 'anonymous_actioned_on_card' }))] : '',
        d.status === 'notified' ? run('Close', () => call('POST', `/api/staff/dissents/${d.id}/close`, { expectedVersion: v, reason: 'notified' })) : ''),
      status);
  });
  main.replaceChildren(el('h2', {}, 'Objections'), ...(items.length ? items : [el('p', { class: 'muted' }, 'Nothing open.')]));
}

// ── invites ─────────────────────────────────────────────────────────────
async function invites() {
  nav.hidden = false;
  const name = input('name'); const countries = input('countries', 'text', { placeholder: 'TCD, SDN' }); const themes = input('themes');
  const out = el('div'); const status = el('div');
  main.replaceChildren(el('section', {},
    el('h2', {}, 'Invite an expert'),
    el('p', { class: 'muted' }, 'The link works once and is shown once. It is bound to the countries below.'),
    ...field('name', 'Name (optional, kept on the roster only)', name),
    ...field('countries', 'Countries (at least one, comma-separated)', countries),
    ...field('themes', 'Themes (optional)', themes),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: async () => {
      try {
        const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
        const r = await call('POST', '/api/staff/invites', { name: name.value || undefined, declaration: { countries: list(countries.value), themes: list(themes.value) } });
        const link = `${location.origin}/#invite=${r.token}`;
        status.replaceChildren();
        out.replaceChildren(el('div', { class: 'msg ok' }, 'Copy this link now; it will not be shown again.', el('pre', { class: 'consent' }, link)));
      } catch (e) { out.replaceChildren(); notice(status, asErr(e).message, 'err'); }
    } }, 'Create invite link')), out, status),
    el('section', {}, el('h2', {}, 'Retention'), el('p', { class: 'muted' }, 'Delete individual answers 12 months after a card resolves. Published aggregates stay.'),
      el('button', { type: 'button', class: 'secondary', onclick: async () => {
        const r = await call('POST', '/api/staff/retention', {}); alert(`Removed ${r.removed} rows.`);
      } }, 'Run retention')));
}

async function audit() {
  nav.hidden = false;
  const rows = await call('GET', '/api/staff/audit');
  main.replaceChildren(el('section', {}, el('h2', {}, 'Audit log'), el('p', { class: 'muted' }, 'Append-only. Expert answers are deliberately not logged.'),
    el('table', {}, el('thead', {}, el('tr', {}, ['When', 'Who', 'Action', 'Target', 'Note'].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.slice().reverse().map((r) => el('tr', {}, el('td', {}, new Date(r.at).toISOString().replace('T', ' ').slice(0, 19)), el('td', {}, `${r.actorId} (${r.role})`), el('td', {}, r.action), el('td', {}, r.target), el('td', {}, r.reason)))))));
}

const TABS = { cards, dissents, invites, audit };

// ── entry: the SSO callback leaves the token in the URL fragment ────────
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) { sessionStorage.setItem('bm.staff', fromHash); history.replaceState(null, '', location.pathname); }
if (sessionStorage.getItem('bm.staff')) show(cards); else signIn();
