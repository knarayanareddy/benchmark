import { useEffect, useState } from 'react';
import { asErr } from '../lib/api.js';
import '../profile.css';

const ISO3 = /^[A-Z]{3}$/;

/**
 * @typedef {{ organisation: string, roleType: string | null, countries: string[], themes: string[], weeklyCap: number }} ProfileValue
 * @typedef {{ themes: Record<string, string>, roleTypes: Record<string, string> }} Vocab
 */

/** @type {ProfileValue} */
export const PROFILE_DEFAULTS = { organisation: '', roleType: null, countries: [], themes: [], weeklyCap: 3 };

/** The first thing wrong with a profile, in words the person can act on, or null. Mirrors the server, which stays the authority. @param {ProfileValue} v */
export function profileProblem(v) {
  if (v.countries.length === 0) return 'Add at least one country, as a 3-letter code such as TCD.';
  const bad = v.countries.find((c) => !ISO3.test(c));
  if (bad !== undefined) return `"${bad}" is not a 3-letter country code.`;
  if (!Number.isInteger(v.weeklyCap) || v.weeklyCap < 1 || v.weeklyCap > 7) return 'The weekly cap must be a whole number from 1 to 7.';
  if (v.organisation.length > 120) return 'The organisation can be at most 120 characters.';
  return null;
}

/** The body PUT /api/me/profile and POST /api/demo/join expect. @param {ProfileValue} v */
export function profileBody(v) {
  return {
    organisation: v.organisation.trim() || null,
    roleType: v.roleType || null,
    countries: v.countries,
    themes: v.themes,
    weeklyCap: v.weeklyCap,
  };
}

/** @param {string} text */
function parseCountries(text) {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

/**
 * The profile fields, controlled. The country box is typed freely and turned into codes as the person types.
 * @param {{ value: ProfileValue, onChange: (v: ProfileValue) => void, vocab: Vocab }} props
 */
export function ProfileFields({ value, onChange, vocab }) {
  const [draft, setDraft] = useState(value.countries.join(', '));
  const set = (/** @type {keyof ProfileValue} */ k, /** @type {any} */ v) => onChange({ ...value, [k]: v });
  /** @param {string} item */
  const toggleTheme = (item) => (/** @type {React.ChangeEvent<HTMLInputElement>} */ e) => set('themes', e.target.checked ? [...value.themes, item] : value.themes.filter((x) => x !== item));

  return (
    <div className="form-grid profile-fields">
      <div className="field wide">
        <label htmlFor="pf-countries">Countries you cover</label>
        <input id="pf-countries" type="text" autoComplete="off" value={draft} aria-describedby="pf-countries-help"
          onChange={(e) => { setDraft(e.target.value); set('countries', parseCountries(e.target.value)); }} />
        <p id="pf-countries-help" className="muted">3-letter ISO codes, separated by commas or spaces, such as TCD, SDN, YEM.</p>
        <ul className="chips" aria-label="Countries chosen">
          {value.countries.map((c) => (
            <li key={c} className={`tag${ISO3.test(c) ? '' : ' bad'}`}>{ISO3.test(c) ? c : `${c} (not a code)`}</li>
          ))}
        </ul>
      </div>

      <fieldset className="field wide">
        <legend>Themes you cover</legend>
        {Object.entries(vocab.themes).map(([k, label]) => (
          <label key={k} className="plain choice-inline">
            <input type="checkbox" checked={value.themes.includes(k)} onChange={toggleTheme(k)} /> {label}
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="pf-role">Role type</label>
        <select id="pf-role" value={value.roleType ?? ''} onChange={(e) => set('roleType', e.target.value || null)}>
          <option value="">Choose one, or leave blank</option>
          {Object.entries(vocab.roleTypes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="pf-org">Organisation (optional)</label>
        <input id="pf-org" type="text" autoComplete="organization" value={value.organisation} aria-describedby="pf-org-help"
          onChange={(e) => set('organisation', e.target.value)} />
        <p id="pf-org-help" className="muted">Only you see this.</p>
      </div>

      <div className="field">
        <label htmlFor="pf-cap">Weekly cap (1 to 7)</label>
        <input id="pf-cap" type="number" min={1} max={7} step={1} inputMode="numeric" aria-describedby="pf-cap-help"
          value={Number.isNaN(value.weeklyCap) ? '' : value.weeklyCap}
          onChange={(e) => set('weeklyCap', e.target.value.trim() === '' ? NaN : Number(e.target.value))} />
        <p id="pf-cap-help" className="muted">How many new questions we put in front of you each week. You can still answer others from your radar.</p>
      </div>
    </div>
  );
}

/**
 * The signed-in person's own profile. In setup it is the first screen after sign-in.
 * Fields the server sends that the form does not edit (regions, minimum match) are ignored.
 * @param {{ api: import('../lib/api.js').Api, setup?: boolean, onSaved?: () => void }} props
 */
export function Profile({ api, setup = false, onSaved }) {
  const heading = setup ? 'Tell us what you cover' : 'My profile';
  const [vocab, setVocab] = useState(/** @type {Vocab | null} */ (null));
  const [value, setValue] = useState(/** @type {ProfileValue | null} */ (null));
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api('GET', '/api/me/profile').then((p) => {
      if (!live) return;
      if (!p?.vocab || !p.declaration) throw new Error('unexpected reply');
      setVocab(p.vocab);
      setValue({
        organisation: p.organisation ?? '',
        roleType: p.roleType ?? null,
        countries: [...p.declaration.countries],
        themes: [...p.declaration.themes],
        weeklyCap: p.weeklyCap,
      });
    }).catch((e) => { if (live) setLoadError(`Your profile could not be loaded. ${asErr(e).message}`); });
    return () => { live = false; };
  }, [api]);

  /** @param {ProfileValue} v */
  function change(v) { setSaved(false); setValue(v); }

  /** @param {import('react').FormEvent} e */
  async function save(e) {
    e.preventDefault();
    if (!value) return;
    setError(''); setSaved(false);
    const problem = profileProblem(value);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await api('PUT', '/api/me/profile', profileBody(value));
      if (!setup) setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(asErr(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <section><h2>{heading}</h2><div className="msg err" role="alert">{loadError}</div></section>;
  if (!value || !vocab) return <section><h2>{heading}</h2><p className="muted">Loading your profile…</p></section>;

  return (
    <section>
      <h2>{heading}</h2>
      {setup && <p>Before you start, tell us which countries and themes you cover. We use this to choose which questions to put in front of you. You can change it later in My data.</p>}
      <form noValidate onSubmit={save}>
        <ProfileFields value={value} onChange={change} vocab={vocab} />
        {error && <div className="msg err" role="alert">{error}</div>}
        {saved && <div className="msg ok" role="status">Saved</div>}
        <div className="row"><button type="submit" disabled={busy}>{setup ? 'Save and continue' : 'Save profile'}</button></div>
      </form>
    </section>
  );
}
