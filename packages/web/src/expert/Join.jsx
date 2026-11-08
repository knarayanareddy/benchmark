import { useEffect, useRef, useState } from 'react';
import { asErr } from '../lib/api.js';
import { createSecret, clearDevice } from '../lib/device.js';
import { encodeRecovery } from '../lib/recovery.js';
import { THEMES, ROLE_TYPES } from '@benchmark/core/taxonomy';
import { STEPS, MAX_COUNTRIES, CAP_OPTIONS, countryName, levelCards, recommendedLevel, validateStep, parseInvite } from '@benchmark/core/onboarding';
import { profileBody } from './Profile.jsx';
import { StepPills } from '../components/StepPills.jsx';
import { ChipGroup } from '../components/ChipGroup.jsx';
import { CountryPicker } from '../components/CountryPicker.jsx';
import '../join.css';

const HEADINGS = ['Your invitation', 'Your expertise', 'Your visibility', 'Your rhythm and confirmation'];
const ROLE_OPTIONS = Object.entries(ROLE_TYPES).map(([value, label]) => ({ value, label }));
const THEME_OPTIONS = Object.entries(THEMES).map(([value, label]) => ({ value, label }));
const CAP_CHIPS = CAP_OPTIONS.map((n) => ({ value: String(n), label: `${n} a week` }));
const BAD_TOKEN = 'That does not look like an invitation link or code. Check that it has no spaces in it.';
// A made-up profile for trying the demo. Labelled as an example in the form; the person edits it freely.
const EXAMPLE = { name: 'Example expert', organisation: 'Example organisation', roleType: 'researcher', countries: ['TCD', 'SDN'], themes: ['conflict', 'food'] };

/**
 * The four-step "Join the circle" wizard (docs/13-onboarding.md). Pilot: a personal invitation, then the profile is
 * saved with the new session. Demo: no invitation; the person gives a name and the demo creates the account.
 * `breakGlass`: the deployment has a safety-override key (the anonymous card says so). Defaults to false: a
 * caller that does not know must not promise an override. `demoLabels`: false in presenter mode hides the demo notice.
 * @param {{ api: import('../lib/api.js').Api, invite: string | null, demo: boolean, deviceKeys: boolean, breakGlass?: boolean, demoLabels?: boolean, onDone: (s: { token: string, mode: string, level: string }) => void, onCancel?: () => void }} props
 */
export function Join({ api, invite, demo, deviceKeys, breakGlass = false, demoLabels = true, onDone, onCancel }) {
  const recognised = parseInvite(invite);
  const firstStep = demo ? 2 : 1;
  const [step, setStep] = useState(firstStep);
  const [pasted, setPasted] = useState('');
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [roleType, setRoleType] = useState(/** @type {string | null} */ (null));
  const [countries, setCountries] = useState(/** @type {string[]} */ ([]));
  const [themes, setThemes] = useState(/** @type {string[]} */ ([]));
  const [example, setExample] = useState(false);
  const [level, setLevel] = useState(/** @type {string | null} */ (null));
  const [device, setDevice] = useState(false);
  const [recovery, setRecovery] = useState(/** @type {string | null} */ (null));
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [loaded, setLoaded] = useState(/** @type {{ key: string | null, value: { version: string, text: string } | null }} */ ({ key: null, value: null }));
  const [accepted, setAccepted] = useState(false);
  const [cap, setCap] = useState(3);
  const [problems, setProblems] = useState(/** @type {string[]} */ ([]));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
  const prevStep = useRef(step);

  const token = recognised ?? parseInvite(pasted);
  const cards = levelCards({ breakGlass });
  const current = cards.find((c) => c.level === level) ?? null;
  const rec = recommendedLevel(countries);

  // Focus the new step's heading on every change of step, not on first render.
  useEffect(() => {
    if (prevStep.current !== step) {
      prevStep.current = step;
      headingRef.current?.focus();
    }
  }, [step]);

  // The consent text for the chosen level and mode. It is only ever shown for the key it was fetched for, so a
  // stale text cannot be joined on after the level or the device key changes.
  const key = level ? `${level}${device ? ':device' : ''}` : null;
  const consent = key && loaded.key === key ? loaded.value : null;
  useEffect(() => {
    if (!level) return undefined;
    let live = true;
    api('GET', `/api/consent/${level}${device ? '?mode=device' : ''}`)
      .then((c) => { if (live) setLoaded({ key: `${level}${device ? ':device' : ''}`, value: c }); })
      .catch((e) => { if (live) setError(asErr(e).message); });
    return () => { live = false; };
  }, [api, level, device]);

  const state = { demo, token, name, organisation, roleType, countries, themes, level, weeklyCap: cap, consentAccepted: accepted, device, recoverySaved };

  /** @param {number} n */
  function problemsFor(n) {
    if (n === 1 && pasted.trim() !== '' && !token) return [BAD_TOKEN];
    const { problems: found } = validateStep(n, state);
    if (n === 4 && !consent) found.push('The consent text has not loaded yet. Choose your level again.');
    return found;
  }

  function goTo(n) {
    setProblems([]);
    setStep(n);
  }

  function next() {
    const found = problemsFor(step);
    setProblems(found);
    if (found.length === 0) goTo(step + 1);
  }

  function back() {
    if (step === firstStep) onCancel?.();
    else goTo(step - 1);
  }

  /** @param {string} l */
  async function chooseLevel(l) {
    setError(''); setAccepted(false);
    setLevel(l);
    if (device && l !== 'anonymous') await setDeviceHeld(false);
  }

  /** A device-held key: a new secret on this device when switched on, removed again when switched off. */
  async function setDeviceHeld(/** @type {boolean} */ on) {
    setError(''); setAccepted(false); setRecoverySaved(false);
    setDevice(on);
    try {
      await clearDevice();
      setRecovery(on ? encodeRecovery(await createSecret()) : null);
    } catch (e) { setError(asErr(e).message); }
  }

  function fillExample() {
    setName(EXAMPLE.name);
    setOrganisation(EXAMPLE.organisation);
    setRoleType(EXAMPLE.roleType);
    setCountries([...EXAMPLE.countries]);
    setThemes([...EXAMPLE.themes]);
    setExample(true);
  }

  /** The profile as the server stores it. Only the five contract fields. */
  const profileValue = () => ({ organisation, roleType, countries, themes, weeklyCap: cap });

  /**
   * The profile save runs with the new session, because the api helper has no session yet. A failure does not
   * block sign-in: App sends a person with no profile to the profile setup screen.
   * @param {string} sessionToken
   */
  async function saveProfile(sessionToken) {
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(profileBody(profileValue())),
      });
      return res.ok;
    } catch { return false; }
  }

  async function join() {
    setError('');
    const found = problemsFor(4);
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      if (demo) {
        const r = await api('POST', '/api/demo/join', {
          name: name.trim(), level, mode: device ? 'device' : 'server', consentVersion: consent?.version, profile: profileBody(profileValue()),
        });
        onDone({ token: r.sessionToken, mode: r.mode, level: r.level });
      } else {
        const r = await api('POST', '/api/invite/redeem', { token, level, consentVersion: consent?.version, mode: device ? 'device' : undefined });
        await saveProfile(r.sessionToken);
        onDone({ token: r.sessionToken, mode: r.mode, level: r.level });
      }
    } catch (e) { setError(asErr(e).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="join">
      <h2>Join the circle</h2>
      <StepPills steps={[...STEPS]} current={step} />
      <h3 ref={headingRef} tabIndex={-1} className="join-step">{HEADINGS[step - 1]}</h3>

      {step === 1 && (
        <>
          <p>Open the personal link you were sent, or paste it here. Each invitation works once.</p>
          {recognised ? (
            <p className="msg ok" role="status">Your invitation was recognised.</p>
          ) : (
            <div className="field">
              <label htmlFor="jn-token">Paste your invitation link or code</label>
              <input id="jn-token" type="text" autoComplete="off" spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <p className="muted">What you declare decides which questions we ask you, never how much weight your answers carry.</p>
          {demo && (
            <>
              {demoLabels && <p className="callout amber">This is a demo deployment. Your account is real here, but the questions and the other experts are made up.</p>}
              <div className="field">
                <label htmlFor="jn-name">Your name</label>
                <input id="jn-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="row">
                <button type="button" className="secondary" onClick={fillExample}>Fill with an example</button>
              </div>
              {example && <p className="muted" role="status">Example profile, change anything you like.</p>}
            </>
          )}
          <div className="field">
            <label htmlFor="jn-org">Organisation (optional)</label>
            <input id="jn-org" type="text" autoComplete="organization" value={organisation} aria-describedby="jn-org-help" onChange={(e) => setOrganisation(e.target.value)} />
            <p id="jn-org-help" className="muted">Only you see this.</p>
          </div>
          <p className="field-label">Your role (optional)</p>
          <ChipGroup label="Your role (optional)" options={ROLE_OPTIONS} value={roleType ?? ''} onChange={(v) => setRoleType(v || null)} />
          <fieldset className="plain-fieldset">
            <legend className="field-label">Countries you cover</legend>
            <CountryPicker value={countries} onChange={setCountries} max={MAX_COUNTRIES} />
          </fieldset>
          <p className="field-label">Themes you cover (optional)</p>
          <ChipGroup label="Themes you cover (optional)" options={THEME_OPTIONS} value={themes} onChange={setThemes} multiple />
        </>
      )}

      {step === 3 && (
        <>
          <p>Choose how your name is handled. Each card shows what each audience would see.</p>
          <div role="radiogroup" aria-labelledby="jn-level-label">
            <p id="jn-level-label" className="field-label">How should your name be handled?</p>
            {cards.map((c) => (
              <label key={c.level} className={`choice ${level === c.level ? 'on' : ''}`}>
                <input type="radio" name="level" value={c.level} checked={level === c.level} onChange={() => chooseLevel(c.level)} />
                <strong>{c.label}</strong>
                {rec.level === c.level && <> <span className="tag teal">Recommended for you</span></>}
                <br />{c.tagline}
                {rec.level === c.level && <><br /><span className="muted">{rec.reason}</span></>}
              </label>
            ))}
          </div>

          {level === 'anonymous' && deviceKeys && (
            <label className="choice nested">
              <input type="checkbox" checked={device} onChange={(e) => setDeviceHeld(e.target.checked)} />
              <strong>Keep my key on this device only</strong><br />
              Nobody, not even the people running this service, can tell which answers are yours, and nothing can be opened for a safety concern.
              If you lose your recovery code you cannot revise or erase those answers.
            </label>
          )}

          {current ? (
            <section className="audience" aria-labelledby="jn-audience">
              <h4 id="jn-audience">What each audience sees</h4>
              <ul>
                {current.audiences.map((a) => <li key={a.who}><strong>{a.who}:</strong> {a.text}</li>)}
              </ul>
              <p className="muted">Caution: {current.warn}</p>
            </section>
          ) : (
            <p className="muted">Choose one of the three to see what each audience would see.</p>
          )}
        </>
      )}

      {step === 4 && (
        <>
          <p>We only ask about {countries.map(countryName).join(', ')} and your chosen themes. You will see anything else, such as a reply to something you raised, when you visit; nothing is sent to your phone or email.</p>
          <p className="field-label">Weekly limit</p>
          <ChipGroup label="Weekly limit" options={CAP_CHIPS} value={String(cap)} onChange={(v) => { if (v) setCap(Number(v)); }} />
          <dl className="summary">
            {demo && <><dt>Name</dt><dd>{name.trim()}</dd></>}
            <dt>Organisation</dt><dd>{organisation.trim() || '—'}</dd>
            <dt>Role</dt><dd>{roleType ? ROLE_TYPES[/** @type {keyof typeof ROLE_TYPES} */ (roleType)] : '—'}</dd>
            <dt>Countries</dt><dd>{countries.map(countryName).join(', ')}</dd>
            <dt>Themes</dt><dd>{themes.length ? themes.map((t) => THEMES[/** @type {keyof typeof THEMES} */ (t)]).join(', ') : '—'}</dd>
            <dt>Visibility</dt><dd>{current ? current.label : '—'}</dd>
            <dt>Weekly limit</dt><dd>{cap} a week</dd>
          </dl>

          <h5>What this means for you</h5>
          {consent ? <pre className="consent">{consent.text}</pre> : !error && <p className="muted">Loading the consent text…</p>}

          {device && recovery && (
            <div className="msg warn">
              <p><strong>Your recovery code.</strong> Write it down or save it in a password manager. It is the only way to use your key on another phone.
                It is shown here once and never sent anywhere.</p>
              <p className="recovery" data-testid="recovery">{recovery}</p>
              <label className="plain"><input type="checkbox" checked={recoverySaved} onChange={(e) => setRecoverySaved(e.target.checked)} /> I have saved my recovery code.</label>
            </div>
          )}

          <label className="plain"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I have read this and I choose this level.</label>
        </>
      )}

      {problems.length > 0 && (
        <div className="msg err" role="alert">
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}

      <div className="join-actions">
        {(step > firstStep || onCancel) && <button type="button" className="secondary" onClick={back}>Back</button>}
        {step < 4
          ? <button type="button" onClick={next}>Continue</button>
          : <button type="button" disabled={busy} onClick={join}>Join the circle</button>}
      </div>
    </section>
  );
}
