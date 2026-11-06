/**
 * @core/a11y — the accessibility primitives both cards need.
 * Small on purpose: fixes, not a framework.
 */

/** Plain-language rule enforced at build time, not at runtime. */
export const MAX_SENTENCE_WORDS = 20;

export function prefersReducedMotion(matchMedia) {
  const mm = matchMedia || globalThis.matchMedia;
  try { return Boolean(mm && mm('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

/** Keep Tab inside a root. Returns a detach function. */
export function trapFocus(root) {
  const sel = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const f = [].slice.call(root.querySelectorAll(sel)).filter((el) => !el.disabled);
    if (!f.length) return;
    const i = f.indexOf(root.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

/** Count sentences that break the plain-language rule. */
export function longSentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().split(/\s+/).length > MAX_SENTENCE_WORDS);
}

/** Announce to screen readers without stealing focus. */
export function announce(message, doc) {
  const d = doc || globalThis.document;
  const el = d.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  el.textContent = message;
  d.body.appendChild(el);
  return () => el.remove();
}
