import { useLoad } from './hooks.js';

const ARMS = [['control', 'No extra background'], ['balanced', 'Reasons for higher and lower'], ['acaps_view', 'ACAPS\'s analysis']];

/** A fraction (0.025) as signed percentage points: +2.5 pts. */
function pts(/** @type {number} */ x) {
  const v = (x * 100).toFixed(1);
  if (Number(v) === 0) return '0.0 pts';
  return `${v.startsWith('-') ? '' : '+'}${v} pts`;
}

/** A suppressed cell shows no numbers at all, only that there were too few answers. @param {any} a @param {number | null | undefined} v */
function cell(a, v) {
  if (!a) return '—';
  if (a.suppressed) return `too few answers (n=${a.n})`;
  return v == null ? '—' : pts(v);
}

function Summary({ api }) {
  const { data, error } = useLoad(() => api('GET', '/api/staff/second-look/summary'));
  if (error) return <section><h2>Second look</h2><div className="msg err" role="alert">{error}</div></section>;
  if (!data) return <p>Loading…</p>;
  return (
    <section>
      <h2>Second look</h2>
      <p className="muted">Cards: {data.cards}</p>
      <table>
        <thead><tr><th>Arm</th><th>Answers</th><th>Mean change</th><th>Mean change toward ACAPS</th><th>Looked at it</th></tr></thead>
        <tbody>
          {ARMS.map(([id, label]) => {
            const a = data.arms?.[id];
            return (
              <tr key={id}>
                <td>{label}</td>
                <td>{a?.n ?? '—'}</td>
                <td>{cell(a, a?.meanShift)}</td>
                <td>{cell(a, a?.meanTowardAcaps)}</td>
                <td>{a?.sawCount ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Each answer is compared with the same person’s first answer. This is descriptive only: it cannot show that the background improves accuracy, which needs resolved outcomes.</p>
    </section>
  );
}

/** Moderators only. Analysts never request the summary at all. @param {{ api: import('../lib/api.js').Api, me: { id: string, role: string } }} props */
export function SecondLook({ api, me }) {
  if (me.role !== 'moderator') return <section><h2>Second look</h2><p className="muted">Only moderators can use this.</p></section>;
  return <Summary api={api} />;
}
