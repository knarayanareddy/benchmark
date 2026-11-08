import { useState } from 'react';
import { asErr } from '../lib/api.js';
import { knownCards, cachedBallot, clearDevice } from '../lib/device.js';
import { anonymous } from '../lib/send.js';

/** @param {{ api: import('../lib/api.js').Api, mode: 'server' | 'device', onErased: () => void }} props */
export function MyData({ api, mode, onErased }) {
  const [msg, setMsg] = useState(/** @type {{ kind: string, text: string } | null} */ (null));

  async function download() {
    const data = await api('GET', '/api/me/export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'my-data.json';
    a.click();
  }

  async function erase() {
    if (!window.confirm('Erase everything? This cannot be undone.')) return;
    try {
      let removed = 0;
      if (mode === 'device') {
        // Only this device can find its answers, so it erases them first.
        for (const cardId of await knownCards()) {
          const b = await cachedBallot(cardId);
          if (b) { try { removed += (await anonymous('POST', '/api/anon/erase', { cardId, ...b })).removed; } catch { /* already gone */ } }
        }
      }
      await api('DELETE', '/api/me');
      await clearDevice();
      setMsg({ kind: 'ok', text: `Your data has been removed${mode === 'device' ? ` (${removed} answer${removed === 1 ? '' : 's'} erased from this device's key)` : ''}.` });
      onErased();
    } catch (e) { setMsg({ kind: 'err', text: asErr(e).message }); }
  }

  return (
    <section>
      <h2>My data</h2>
      <p>Download everything held about you, or erase it. Erasing removes your answers, your objections (except anonymous ones, which cannot be linked to you), your alias and your account.</p>
      {mode === 'device' && <p className="muted">Your answers are held under a key only this phone has. Erasing here removes them using that key; they cannot be found any other way.</p>}
      <div className="row">
        <button type="button" className="secondary" onClick={download}>Download my data</button>
        <button type="button" className="danger" onClick={erase}>Erase my data and leave</button>
      </div>
      {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
    </section>
  );
}
