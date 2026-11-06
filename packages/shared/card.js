/**
 * @core/card — the shared decision surface.
 *
 * Both products put one decision in front of one person in ninety seconds:
 * Doorway gates a search, Benchmark asks for an estimate. Same shape, same
 * accessibility requirements, same one-action rule. This is the only rendering
 * code that is byte-identical between the two repositories.
 *
 * Descriptor building and validation are unit-tested. mount() needs a DOM and
 * is verified manually (keyboard-only pass, screen-reader pass, 320px).
 */

export const VARIANTS = Object.freeze(['gate', 'blur', 'card', 'chat', 'quiet']);
export const ACTION_KINDS = Object.freeze(['primary', 'secondary', 'dismiss']);

export function buildCard({
  variant = 'card',
  headline,
  body = '',
  primary,
  secondary = null,
  attribution = null,
  footnote = null,
  lang = 'en',
} = {}) {
  const d = {
    variant, lang,
    headline: String(headline ?? '').trim(),
    body: String(body ?? '').trim(),
    primary, secondary, attribution, footnote,
  };
  const v = validate(d);
  if (!v.ok) throw new Error('invalid card: ' + v.errors.join('; '));
  return d;
}

export function validate(d = {}) {
  const errors = [];
  if (!VARIANTS.includes(d.variant)) errors.push('variant must be one of ' + VARIANTS.join('|'));
  if (!d.headline) errors.push('headline is required');
  if (d.headline && d.headline.length > 90) errors.push('headline over 90 chars — will not fit one screen at 320px');
  if (!d.primary || typeof d.primary.label !== 'string' || !d.primary.label.trim()) {
    errors.push('primary action with a label is required');
  }
  if (d.primary && d.primary.kind && !ACTION_KINDS.includes(d.primary.kind)) {
    errors.push('primary.kind must be one of ' + ACTION_KINDS.join('|'));
  }
  if (d.body && d.body.length > 420) errors.push('body over 420 chars — will need scrolling');
  return { ok: errors.length === 0, errors };
}

/**
 * Mount into a shadow root so a host page's CSS cannot break the card and the
 * card cannot break the host. Returns { el, close, outcome }.
 */
export function mount(d, { onOutcome, doc = globalThis.document } = {}) {
  const host = doc.createElement('div');
  host.setAttribute('data-core-card', d.variant);
  doc.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = doc.createElement('div');
  wrap.className = d.variant === 'quiet' ? 'quiet' : 'ovl';
  wrap.innerHTML = render(d);
  root.appendChild(wrap);

  const buttons = [...root.querySelectorAll('button')];
  const primary = root.querySelector('[data-act="primary"]');
  const prev = doc.activeElement;
  let outcome = 'timeout';

  const close = () => {
    host.remove();
    if (prev && prev.focus) prev.focus();
    if (onOutcome) onOutcome({ outcome, variant: d.variant });
  };
  const finish = (o) => { if (outcome === 'timeout') outcome = o; close(); };

  const p = root.querySelector('[data-act="primary"]');
  if (p) p.addEventListener('click', () => { if (d.primary.onSelect) d.primary.onSelect(); finish('primary'); });
  const s = root.querySelector('[data-act="secondary"]');
  if (s) s.addEventListener('click', () => { if (d.secondary.onSelect) d.secondary.onSelect(); finish('secondary'); });
  const x = root.querySelector('[data-act="dismiss"]');
  if (x) x.addEventListener('click', () => finish('dismiss'));

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { finish('dismiss'); return; }
    if (e.key !== 'Tab' || buttons.length === 0) return;
    const i = buttons.indexOf(root.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
    else if (!e.shiftKey && i === buttons.length - 1) { e.preventDefault(); buttons[0].focus(); }
  });

  setTimeout(() => { const f = primary || buttons[0]; if (f) f.focus(); }, 30);

  if (d.variant === 'quiet') setTimeout(() => { if (host.isConnected) close(); }, 9000);

  return { el: host, close, outcome: () => outcome };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function render(d) {
  if (d.variant === 'quiet') return esc(d.body || d.headline);
  const attr = d.attribution
    ? '<div class="bar"><span class="attr">' + esc(d.attribution) + '</span>' +
      '<button class="x" data-act="dismiss" aria-label="Close">\u00d7</button></div>'
    : '<div class="bar"><span></span><button class="x" data-act="dismiss" aria-label="Close">\u00d7</button></div>';
  const sec = d.secondary ? '<button class="alt" data-act="secondary">' + esc(d.secondary.label) + '</button>' : '';
  const foot = d.footnote ? '<p class="conf">' + esc(d.footnote) + '</p>' : '';
  return '<div>' + attr +
    (d.headline ? '<h2>' + esc(d.headline) + '</h2>' : '') +
    (d.body ? '<p>' + esc(d.body) + '</p>' : '') +
    '<button class="cta" data-act="primary">' + esc(d.primary.label) + '</button>' +
    sec + foot + '</div>';
}

const CSS = [
  ':host{all:initial}',
  '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
  '.ovl{position:fixed;inset:0;background:rgba(20,18,16,.72);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;padding:0}',
  '@media(min-width:560px){.ovl{align-items:center;padding:24px}}',
  '.ovl>div{background:#fff;color:#1b1a18;width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;padding:24px 22px 18px;box-shadow:0 8px 40px rgba(0,0,0,.35)}',
  '@media(min-width:560px){.ovl>div{border-radius:14px}}',
  '.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}',
  '.attr{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#6d665e;font-weight:700}',
  '.x{background:none;border:0;font-size:24px;line-height:1;color:#9a938a;cursor:pointer;padding:6px 10px;border-radius:6px}',
  '.x:focus-visible{outline:3px solid #1f4e79;outline-offset:2px}',
  'h2{font-family:Georgia,serif;font-size:20px;line-height:1.25;margin:0 0 10px;font-weight:600}',
  'p{font-size:15px;line-height:1.5;margin:0 0 12px;color:#3d3934}',
  '.cta{display:block;width:100%;background:#1f4e79;color:#fff;border:0;border-radius:9px;font-size:16px;font-weight:650;padding:15px 16px;margin-top:16px;cursor:pointer;min-height:48px}',
  '.cta:focus-visible{outline:3px solid #1b1a18;outline-offset:2px}',
  '.alt{display:block;width:100%;background:none;border:1px solid #d2cbc0;border-radius:9px;font-size:14px;color:#3d3934;padding:12px;margin-top:9px;cursor:pointer;min-height:44px}',
  '.conf{font-size:12px;color:#6d665e;margin-top:14px;border-top:1px solid #e2ddd4;padding-top:11px}',
  '.quiet{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#26241f;color:#f5f1e8;font-size:13px;padding:11px 16px;border-radius:999px;z-index:2147483000;max-width:92vw}',
  '@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}',
].join('\n');
