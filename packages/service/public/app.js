import { el, api, pct, notice, byId, asErr } from '/ui.js';

const call = api('bm.session');
const main = byId('main');
const nav = byId('nav');
const LEVELS = [
  ['identified', 'Known', 'ACAPS and your colleagues see your name.'],
  ['pseudonymous', 'Pseudonymous', 'ACAPS knows who you are. Colleagues see a stable alias, such as “Analyst 4217”.'],
  ['anonymous', 'Anonymous', 'ACAPS cannot see who you are in normal use. You find follow-up questions by visiting here.'],
];

byId('go-inbox').addEventListener('click', () => show(inbox));
byId('go-data').addEventListener('click', () => show(myData));
byId('sign-out').addEventListener('click', () => { sessionStorage.clear(); location.hash = ''; location.reload(); });

async function show(view) {
  try { await view(); } catch (e) {
    if (asErr(e).status === 401) { sessionStorage.removeItem('bm.session'); return start(); }
    main.replaceChildren(el('div', { class: 'msg err', role: 'alert' }, asErr(e).message));
  }
}

// ── onboarding: invite -> level -> consent ──────────────────────────────
async function onboard(inviteToken) {
  nav.hidden = true;
  let level = null;
  const consentBox = el('div');
  const status = el('div');
  const accept = el('input', { type: 'checkbox', id: 'accept' });
  const go = el('button', { type: 'button', disabled: true }, 'Accept and continue');
  let version = null;

  const choose = async (l) => {
    level = l;
    const c = await call('GET', `/api/consent/${l}`);
    version = c.version;
    consentBox.replaceChildren(el('pre', { class: 'consent' }, c.text),
      el('label', { for: 'accept', class: 'plain' }, accept, ' I have read this and I choose this level.'));
    accept.checked = false; go.disabled = true;
    for (const n of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('label.choice'))) n.classList.toggle('on', n.dataset.level === l);
  };
  accept.addEventListener('change', () => { go.disabled = !accept.checked; });
  go.addEventListener('click', async () => {
    try {
      const r = await call('POST', '/api/invite/redeem', { token: inviteToken, level, consentVersion: version });
      sessionStorage.setItem('bm.session', r.sessionToken);
      history.replaceState(null, '', location.pathname);
      show(inbox);
    } catch (e) { notice(status, asErr(e).message, 'err'); }
  });

  main.replaceChildren(
    el('section', {},
      el('h2', {}, 'Welcome'),
      el('p', {}, 'You can answer a question in about ninety seconds. First, choose how your name is handled. You can erase everything later.'),
      LEVELS.map(([v, label, text]) => el('label', { class: 'choice', 'data-level': v },
        el('input', { type: 'radio', name: 'level', value: v, onchange: () => choose(v).catch((e) => notice(status, asErr(e).message, 'err')) }),
        el('strong', {}, label), el('br'), text)),
      consentBox, status, el('div', { class: 'row' }, go))
  );
}

// ── inbox ───────────────────────────────────────────────────────────────
function describeRelease(r) {
  if (!r || r.suppressed) return el('p', { class: 'muted' }, 'The panel result is not published yet.');
  return el('p', {}, `Panel (${r.n} experts): ${pct(r.estimate)}, range ${pct(r.lo)}–${pct(r.hi)}.`);
}

function answerCard(card, { revise = false, yourEstimate = null, release = null }, refresh) {
  const start = yourEstimate ?? card.seedP ?? 0.5;
  const out = el('output', { class: 'big', for: `s-${card.id}` }, pct(start));
  const slider = el('input', { type: 'range', id: `s-${card.id}`, min: 1, max: 99, step: 1, value: Math.round(start * 100),
    'aria-label': 'Your probability that this happens', oninput: () => { out.textContent = `${slider.value}%`; } });
  const status = el('div');
  const send = el('button', { type: 'button', onclick: async () => {
    send.disabled = true;
    try {
      const r = await call('POST', '/api/estimates', { cardId: card.id, p: Number(slider.value) / 100 });
      notice(status, `Saved: ${pct(r.p)}${r.clamped ? ' (kept within 1–99%)' : ''}. Thank you.`);
      slider.disabled = true;
      send.replaceWith(el('button', { type: 'button', class: 'secondary', onclick: refresh }, 'Next question'));
    } catch (e) { notice(status, asErr(e).message, 'err'); send.disabled = false; }
  } }, revise ? 'Save my revision' : 'Submit');
  return el('div', { class: 'card' },
    el('h3', {}, card.statement),
    el('p', { class: 'muted' }, `${card.country}${card.window ? ` · resolves by ${card.window.to}` : ''}${revise ? ' · round 2' : ''}`),
    revise ? [describeRelease(release), el('p', { class: 'muted' }, `Your first answer was ${pct(Number(yourEstimate))}. You may revise it.`)]
      : el('p', { class: 'muted' }, `Starts at ACAPS’ own reading (${pct(start)}). Move it to what you think.`),
    out, slider, el('div', { class: 'row' }, send), status, dissentForm(card));
}

function dissentForm(card) {
  const kind = el('select', { id: `k-${card.id}` },
    [['two_risks', 'This is really two questions'], ['window', 'The time window is wrong'],
      ['already_happening', 'This has already happened'], ['intent_not_condition', 'This is about intent, not something observable']]
      .map(([v, t]) => el('option', { value: v }, t)));
  const text = el('textarea', { id: `t-${card.id}`, maxlength: 2000, placeholder: 'Say what is wrong with the question, not who you are.' });
  const status = el('div');
  const box = el('div', { hidden: true },
    el('label', { for: kind.id }, 'What is wrong?'), kind, el('label', { for: text.id }, 'Details'), text,
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: async () => {
      try {
        const r = await call('POST', '/api/dissents', { cardId: card.id, kind: kind.value, text: text.value });
        const w = r.warnings || [];
        notice(status, w.length ? `Sent. Before it is read: ${w.join('; ')}. You may want to remove those details next time.` : 'Sent. We will tell you what changes.', w.length ? 'warn' : 'ok');
        text.value = '';
      } catch (e) { notice(status, asErr(e).message, 'err'); }
    } }, 'Send objection')), status);
  return el('div', {}, el('div', { class: 'row' }, el('button', { class: 'secondary', type: 'button', onclick: () => { box.hidden = !box.hidden; } }, 'Something is wrong with this question')), box);
}

async function inbox() {
  nav.hidden = false;
  const box = await call('GET', '/api/inbox');
  const refresh = () => show(inbox);
  const parts = [];
  if (box.notifications.length) {
    parts.push(el('section', {}, el('h2', {}, 'What changed because of you'),
      box.notifications.map((n) => el('p', {}, n.body))));
  }
  if (box.openForRevision.length) {
    parts.push(el('h2', {}, 'Open for revision'),
      box.openForRevision.map((c) => answerCard(c, { revise: true, yourEstimate: c.yourEstimate, release: c.release }, refresh)));
  }
  parts.push(el('h2', {}, 'New questions'));
  parts.push(box.toAnswer.length ? box.toAnswer.map((c) => answerCard(c, {}, refresh))
    : el('p', { class: 'muted' }, 'Nothing new for you right now. Come back later.'));
  main.replaceChildren(...parts.flat());
}

// ── my data ─────────────────────────────────────────────────────────────
async function myData() {
  nav.hidden = false;
  const status = el('div');
  main.replaceChildren(el('section', {},
    el('h2', {}, 'My data'),
    el('p', {}, 'Download everything held about you, or erase it. Erasing removes your answers, your objections (except anonymous ones, which cannot be linked to you), your alias and your account.'),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'secondary', onclick: async () => {
        const d = await call('GET', '/api/me/export');
        const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })), download: 'my-data.json' });
        a.click();
      } }, 'Download my data'),
      el('button', { type: 'button', class: 'danger', onclick: async () => {
        if (!confirm('Erase everything? This cannot be undone.')) return;
        try { await call('DELETE', '/api/me'); sessionStorage.clear(); main.replaceChildren(el('section', {}, el('h2', {}, 'Erased'), el('p', {}, 'Your data has been removed.'))); nav.hidden = true; }
        catch (e) { notice(status, asErr(e).message, 'err'); }
      } }, 'Erase my data and leave')),
    status));
}

// ── entry ───────────────────────────────────────────────────────────────
async function start() {
  const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invite) return onboard(invite);
  if (sessionStorage.getItem('bm.session')) return show(inbox);
  nav.hidden = true;
  main.replaceChildren(el('section', {}, el('h2', {}, 'Ground Truth'),
    el('p', {}, 'This is an invitation-only panel. Open the personal link you were sent to take part.')));
}
start();
