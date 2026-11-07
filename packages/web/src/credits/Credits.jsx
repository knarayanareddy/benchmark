import { useEffect, useState } from 'react';
import '../credit.css';

/** @typedef {{ id: string, text: string, creditLine: string | null, cardStatement: string, country: string, day: string }} Credit */

/** Public and login-free: a plain fetch, deliberately without the staff or expert api helper (no bearer token). */
async function loadCredits() {
  const res = await fetch('/api/public/credits');
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return /** @type {Credit[]} */ (await res.json());
}

export function Credits() {
  const [items, setItems] = useState(/** @type {Credit[] | null} */ (null));
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    loadCredits()
      .then((d) => { if (live) setItems([...d].sort((a, b) => b.day.localeCompare(a.day))); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, []);

  return (
    <>
      <header>
        <h1>Ground Truth</h1>
      </header>
      <main>
        <h1 className="page-title">Published contributions</h1>
        <p className="page-sub">Every item here was published with its author’s consent. Each one is a single contribution that its author agreed could be shared; some are named and some are not.</p>
        {error && <div className="msg err" role="alert">Could not load published contributions. Please try again later.</div>}
        {!error && items === null && <p>Loading…</p>}
        {items && items.length === 0 && <p className="muted">Nothing has been published yet.</p>}
        {items && items.length > 0 && (
          <ul className="credit-list">
            {items.map((c) => (
              <li key={c.id} className="card credit-item">
                <p className="muted">{c.day} · {c.country}</p>
                <h2>{c.cardStatement}</h2>
                <p className="pre-wrap">{c.text}</p>
                <p className="muted">{c.creditLine ? `Credit: ${c.creditLine}` : 'Uncredited'}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
