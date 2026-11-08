import { countryName } from '@benchmark/core/onboarding';
import { THEMES } from '@benchmark/core/taxonomy';
import { CardView } from './CardView.jsx';
import '../pulse.css';

/** "9 May 2027" for the day a card's window ends. The window is a calendar day, so it is read in UTC. @param {any} card */
export function closesOn(card) {
  const to = card?.window?.to;
  if (!to) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${to}T00:00:00Z`));
}

/**
 * One question on its own page: the breadcrumb row, then the answer card in place. Back and the answer's own
 * "Next question" both return to Pulse.
 * @param {{ api: import('../lib/api.js').Api, entry: { card: any }, mode: 'server' | 'device', onBack: () => void, onNext: () => void }} props
 */
export function QuestionPage({ api, entry, mode, onBack, onNext }) {
  const { card } = entry;
  const closes = closesOn(card);
  return (
    <div className="question-page">
      <div className="question-crumbs">
        <button type="button" className="secondary link question-back" onClick={onBack}>← Pulse</button>
        <span>·</span>
        {card.country && <span className="pill teal">{countryName(card.country)}</span>}
        {card.theme && <span className="pill">{THEMES[card.theme] ?? card.theme}</span>}
        <span className="pill indigo">Risk question</span>
        {closes && <span>closes {closes}</span>}
      </div>
      <CardView api={api} card={card} mode={mode} onNext={onNext} />
    </div>
  );
}
