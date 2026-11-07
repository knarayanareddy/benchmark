import { useState } from 'react';
import { asErr } from '../lib/api.js';
import { createSecret, clearDevice } from '../lib/device.js';
import { encodeRecovery } from '../lib/recovery.js';

const LEVELS = [
  ['identified', 'Known', 'ACAPS and your colleagues see your name.'],
  ['pseudonymous', 'Pseudonymous', 'ACAPS knows who you are. Colleagues see a stable alias, such as “Analyst 4217”.'],
  ['anonymous', 'Anonymous', 'ACAPS cannot see who you are in normal use. You find follow-up questions by visiting here.'],
];

/** @param {{ api: import('../lib/api.js').Api, invite: string, deviceKeys: boolean, onDone: (s: { token: string, mode: string, level: string }) => void }} props */
export function Onboard({ api, invite, deviceKeys, onDone }) {
  const [level, setLevel] = useState(/** @type {string | null} */ (null));
  const [device, setDevice] = useState(false);
  const [consent, setConsent] = useState(/** @type {{ version: string, text: string, level?: string } | null} */ (null));
  const [accepted, setAccepted] = useState(false);
  const [recovery, setRecovery] = useState(/** @type {string | null} */ (null));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function choose(l, dev = device) {
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
    setError('');
    try {
      const r = await api('POST', '/api/invite/redeem', { token: invite, level, consentVersion: consent?.version, mode: device ? 'device' : undefined });
      onDone({ token: r.sessionToken, mode: r.mode, level: r.level });
    } catch (e) { setError(asErr(e).message); }
  }

  const ready = consent && accepted && (!device || saved);
  return (
    <section>
      <h2>Welcome</h2>
      <p>You can answer a question in about ninety seconds. First, choose how your name is handled. You can erase everything later.</p>
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend className="muted">How should your name be handled?</legend>
        {LEVELS.map(([v, label, text]) => (
          <label key={v} className={`choice ${level === v ? 'on' : ''}`}>
            <input type="radio" name="level" value={v} checked={level === v} onChange={() => choose(v, v === 'anonymous' ? device : false)} />
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

      {consent && <pre className="consent">{consent.text}</pre>}

      {device && recovery && (
        <div className="msg warn">
          <p><strong>Your recovery code.</strong> Write it down or save it in a password manager. It is the only way to use your key on another phone.
            It is shown here once and never sent anywhere.</p>
          <p className="recovery" data-testid="recovery">{recovery}</p>
          <label className="plain"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery code.</label>
        </div>
      )}

      {consent && (
        <label className="plain"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I have read this and I choose this level.</label>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="row"><button type="button" disabled={!ready} onClick={join}>Accept and continue</button></div>
    </section>
  );
}
