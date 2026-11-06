/**
 * @core/loop — the return path.
 *
 * A product is only retainable if the person is told what their action caused.
 * Doorway: nobody returns for a warning, but the service-side arrival count
 * closes the loop back to the platform. Benchmark: an expert who objects into
 * silence never objects twice.
 */

export const LOOP_KIND = Object.freeze({
  REWRITE: 'rewrite',
  SPLIT: 'split',
  RETIRE: 'retire',
  RESOLVE_EARLY: 'resolve_early',
  ROUTED: 'routed',
  ARRIVED: 'arrived',
});

const T = {};
T[LOOP_KIND.REWRITE] = (d) => 'You said the wording was wrong. It has been rewritten' + (d && d.title ? ': "' + d.title + '"' : '.');
T[LOOP_KIND.SPLIT] = (d) => 'You said this was two risks. It has been split' + (d && d.count ? ' into ' + d.count : '') + '. Here they are.';
T[LOOP_KIND.RETIRE] = () => 'You said this could not be resolved. It has been retired.';
T[LOOP_KIND.RESOLVE_EARLY] = () => 'You said this had already happened. It has been resolved early.';
T[LOOP_KIND.ROUTED] = (d) => 'Someone was offered help through you' + (d && d.service ? ' — ' + d.service : '') + '.';
T[LOOP_KIND.ARRIVED] = (d) => {
  const n = d && d.count != null ? d.count : 0;
  return n + ' contact' + (n === 1 ? '' : 's') + ' reached ' + ((d && d.service) || 'the service') + ' this month.';
};

/** Compose the loop message. Never names a person who was helped. */
export function compose(kind, data) {
  const d = data || {};
  const t = T[kind];
  if (!t) throw new Error('unknown loop kind: ' + kind);
  return {
    kind,
    body: t(d),
    deepLinks: d.deepLinks || [],
    honesty: d.causal === false ? 'association, not attribution' : null,
  };
}

/** Loop latency is the metric that proves the loop exists. */
export function latency(openedAt, closedAt) {
  if (!openedAt) return null;
  const end = closedAt == null ? Date.now() : closedAt;
  return Math.max(0, end - openedAt);
}
