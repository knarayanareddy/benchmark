import { useState } from 'react';
import { asErr } from '../lib/api.js';
import { createSecret, clearDevice } from '../lib/device.js';
import { encodeRecovery } from '../lib/recovery.js';
import { THEMES, ROLE_TYPES } from '@benchmark/core/taxonomy';
import { ProfileFields, PROFILE_DEFAULTS, profileProblem, profileBody } from './Profile.jsx';
import '../profile.css';

// The same levels and wording as Onboard.jsx (not exported from there).
const LEVELS = [
  ['identified', 'Known', 'ACAPS and your colleagues see your name.'],
  ['pseudonymous', 'Pseudonymous', 'ACAPS knows who you are. Colleagues see a stable alias, such as “Analyst 4217”.'],
  ['anonymous', 'Anonymous', 'ACAPS cannot see who you are in normal use. You find follow-up questions by visiting here.'],
];

const VOCAB = { themes: THEMES, roleTypes: ROLE_TYPES };

/**
 * Demo mode only: open a real account from what the person types, without an invite.
 * @param {{ api: import('../lib/api.js').Api, deviceKeys: boolean, onDone: (s: { token: string, mode: string, level: string }) => void }} props
 */
export function DemoJoin({ api, deviceKeys, onDone }) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState(/** @type {string | null} */ (null));
  const [device, setDevice] = useState(false);
  const [consent, setConsent] = useState(/** @type {{ version: string, text: string } | null} */ (null));
  const [accepted, setAccepted] = useState(false);
  const [recovery, setRecovery] = useState(/** @type {string | null} */ (null));
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState(PROFILE_DEFAULTS);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function choose(/** @type {string} */ l, dev = device) {
    setError(''); setAccepted(false); setSaved(false);
    setLevel(l); setDevice(dev);
    try {
      setConsent(await api('GET', `/api/consent/${l}${dev ? '?mode=device' : ''}`));
      if (dev) {
        await clearDevice();
        setRecovery(encodeRecovery(await createSecret()));
      } else setRecovery(null);
    } catch (e) { setError(asErr(e).message); }
  }

  async function join() {
    setError(''); setBusy(true);
    try {
      const r = await api('POST', '/api/demo/join', {
        name: name.trim(), level, mode: device ? 'device' : 'server', consentVersion: consent?.version, profile: profileBody(profile),
      });
      onDone({ token: r.sessionToken, mode: r.mode, level: r.level });
    } catch (e) { setError(asErr(e).message); }
    finally { setBusy(false); }
  }

  const problem = profileProblem(profile);
  const missing = !name.trim() ? 'Add your name.' : !level ? 'Choose how your name is handled.' : problem;
  const ready = Boolean(consent) && accepted && (!device || saved) && !missing;

  return (
    <details className="demo-join">
      <summary>Try the demo</summary>
      <div className="demo-join-body">
        <p className="callout amber">This is a demo deployment. Your account is real here, but the questions and the other experts are made up.</p>

        <div className="field">
          <label htmlFor="dj-name">Your name</label>
          <input id="dj-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <fieldset className="plain-fieldset">
          <legend className="muted">How should your name be handled?</legend>
          {LEVELS.map(([v, label, text]) => (
            <label key={v} className={`choice ${level === v ? 'on' : ''}`}>
              <input type="radio" name="demo-level" value={v} checked={level === v} onChange={() => choose(v, v === 'anonymous' ? device : false)} />
              <strong>{label}</strong><br />{text}
            </label>
          ))}
        </fieldset>

        {level === 'anonymous' && deviceKeys && (
          <label className="choice">
            <input type="checkbox" checked={device} onChange={(e) => choose('anonymous', e.target.checked)} />
            <strong>Keep my key on this device only</strong><br />
            Nobody, not even the people running this service, can tell which answers are yours, and nothing can be opened for a safety concern.
            If you lose your recovery code you cannot revise or erase those answers.
          </label>
        )}

        {consent && <><h5>What this means for you</h5><pre className="consent">{consent.text}</pre></>}

        {device && recovery && (
          <div className="msg warn">
            <p><strong>Your recovery code.</strong> Write it down or save it in a password manager. It is the only way to use your key on another phone.
              It is shown here once and never sent anywhere.</p>
            <p className="recovery" data-testid="recovery">{recovery}</p>
            <label className="plain"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery code.</label>
          </div>
        )}

        <h5>Your profile</h5>
        <ProfileFields value={profile} onChange={setProfile} vocab={VOCAB} />

        {consent && (
          <label className="plain"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I have read this.</label>
        )}
        {!ready && missing && <p className="muted">{missing}</p>}
        {error && <div className="msg err" role="alert">{error}</div>}
        <div className="row"><button type="button" disabled={!ready || busy} onClick={join}>Join the demo</button></div>
      </div>
    </details>
  );
}
