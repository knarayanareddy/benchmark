import { countryName } from '@benchmark/core/onboarding';
import '../pulse.css';

/**
 * The three cards beside Pulse. A circle under five members is "forming" and shows no counts of its views:
 * with so few people a count would say who had answered (the same rule as the question page).
 * @param {{ circle?: { country: string, members: number | null, openCards: number, withView: number } | null, record?: { answered: number, revised: number, objections: number } | null, onOpenData: () => void }} props
 */
export function SideCards({ circle, record, onOpenData }) {
  const forming = circle && circle.members == null;
  return (
    <aside className="pulse-side" aria-label="Your circle and standing">
      <div className="card">
        <div className="pulse-kicker">{circle ? `Your circle · ${countryName(circle.country)}` : 'Your circle'}</div>
        {!circle && <p className="pulse-side-text">Circle numbers are not available right now.</p>}
        {circle && (forming
          ? <div className="pulse-big">forming</div>
          : <div className="pulse-big">{circle.members} <span>members</span></div>)}
        {circle && (forming
          ? <p className="pulse-side-text">Your circle is still forming.</p>
          : <p className="pulse-side-text">{circle.withView} of {circle.openCards} open {countryName(circle.country)} risks have a circle view. Coverage is a shared goal — there is no public leaderboard.</p>)}
      </div>
      <div className="card">
        <div className="pulse-kicker">Your standing (private)</div>
        <div className="pulse-standing">
          <span className="pill">Invited</span>
          {record
            ? <span>{record.answered} answered · {record.revised} revised · {record.objections} objections</span>
            : <span>Your answers are held under a key only your phone has, so we cannot count them here.</span>}
        </div>
        <p className="pulse-side-text">Your first resolved question unlocks your calibration mirror.</p>
        <button type="button" className="secondary link pulse-open" onClick={onOpenData}>Open my space</button>
      </div>
      <div className="card">
        <div className="pulse-kicker">Craft badges</div>
        <p className="pulse-side-text">Earned for quality, never volume.</p>
      </div>
    </aside>
  );
}
