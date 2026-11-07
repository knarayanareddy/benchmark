import { useCallback, useEffect, useRef, useState } from 'react';
import { asErr } from '../lib/api.js';

/**
 * Load something from the API once, and expose a reload. `fn` is read through a ref so a new
 * closure on each render neither re-runs the load nor makes `reload` change identity.
 * @param {() => Promise<any>} fn
 */
export function useLoad(fn) {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setData(await latest.current()); setError(''); } catch (e) { setError(asErr(e).message); }
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try { const d = await latest.current(); if (live) { setData(d); setError(''); } } catch (e) { if (live) setError(asErr(e).message); }
    })();
    return () => { live = false; };
  }, []);
  return { data, error, reload };
}

export const problems = (/** @type {unknown} */ e) => { const x = asErr(e); return [x.message, ...(x.data?.problems || [])].join(' — '); };
