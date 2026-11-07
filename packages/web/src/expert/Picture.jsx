import '../picture.css';

/** A fraction (0..1) as a percent position, rounded so 0.55 is exactly 55 and not 55.00000000000001. */
const at = (/** @type {number} */ f) => Math.round(f * 10000) / 100;
const whole = (/** @type {number} */ f) => Math.round(f * 100);

/**
 * The Round-2 picture: where ACAPS sits, the circle's pooled estimate and its range, and this expert's own numbers.
 * @param {{ acaps: { p: number } | null | undefined, release: any, mine: number | null | undefined, revised: number | null | undefined }} props
 *   `acaps.p` is a percent; `release` holds fractions (or is suppressed); `mine` is a fraction; `revised` is a percent.
 */
export function Picture({ acaps, release, mine, revised }) {
  const live = release && !release.suppressed ? release : null;
  const hasAcaps = !!acaps && typeof acaps.p === 'number';
  const hasMine = typeof mine === 'number';
  const hasRevised = typeof revised === 'number';
  const bandLeft = live ? at(live.lo) : 0;
  const bandWidth = live ? Math.max(2, at(live.hi) - at(live.lo)) : 0;
  const rangeWords = live ? `circle range ${whole(live.lo)} to ${whole(live.hi)} percent` : '';
  const label = [
    'Probability bar from 0 to 100 percent.',
    hasAcaps ? `ACAPS rating ${acaps.p} percent.` : '',
    live ? `Circle pooled estimate ${whole(live.estimate)} percent, ${rangeWords}.` : 'The circle result is not published yet.',
    hasMine ? `Your first estimate ${whole(mine)} percent.` : '',
    hasRevised ? `Revised estimate ${revised} percent.` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="picture-card">
      <h4 className="picture-title">The picture</h4>
      <div className="picture-bar">
        <div className="picture-track" role="img" aria-label={label}>
          {live && (
            <div className="picture-band" title={`Circle range ${whole(live.lo)}–${whole(live.hi)}%`}
              style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
          )}
          {live && <div className="picture-mark" style={{ left: `${at(live.estimate)}%` }} />}
          {hasAcaps && (
            <div className="picture-acaps" style={{ left: `${acaps.p}%` }}>
              ACAPS<div className="picture-tri indigo" />
            </div>
          )}
          {hasMine && (
            <div className="picture-you" style={{ left: `${at(mine)}%` }}>
              ▲<div>you {whole(mine)}%</div>
            </div>
          )}
          {hasRevised && (
            <div className="picture-revised" style={{ left: `${revised}%` }}>
              ▲<div>revised {revised}%</div>
            </div>
          )}
        </div>
        <div className="picture-scale"><span>0%</span><span>50%</span><span>100%</span></div>
      </div>
      <div className="picture-tiles">
        <div className="picture-tile indigo">
          <div className="picture-tile-label">ACAPS</div>
          {hasAcaps
            ? <>
              <div className="picture-tile-value">~{acaps.p}%</div>
              <div className="picture-tile-note">implied by its rating (empirical materialisation rate)</div>
            </>
            : <div className="picture-tile-note">Unrated risk.</div>}
        </div>
        <div className="picture-tile teal">
          <div className="picture-tile-label">Circle (the circle&apos;s pooled estimate)</div>
          {live
            ? <>
              <div className="picture-tile-value">{whole(live.estimate)}%</div>
              <div className="picture-tile-note">Circle range {whole(live.lo)}–{whole(live.hi)}% · n={release.n}</div>
            </>
            : <div className="picture-tile-note">The circle result is not published yet.</div>}
        </div>
      </div>
      {hasMine && (
        <div className="picture-locked">
          Your locked first estimate: <b>{whole(mine)}%</b>
          {hasRevised && <> · revised to <b>{revised}%</b></>}
        </div>
      )}
    </div>
  );
}
