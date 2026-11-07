// The one place the app persists anything on the device: a tiny IndexedDB key-value store.
// The session token, the device-held ballot secret and the offline queue all live here.
const DB = 'benchmark';
const STORE = 'kv';

/** @type {Promise<IDBDatabase> | null} */
let opened = null;

function open() {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return opened;
}

/** @template T @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest<T>} fn @returns {Promise<T>} */
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {string} key @returns {Promise<any>} */
export const kvGet = (key) => run('readonly', (s) => s.get(key));
/** @param {string} key @param {any} value */
export const kvSet = (key, value) => run('readwrite', (s) => s.put(value, key));
/** @param {string} key */
export const kvDel = (key) => run('readwrite', (s) => s.delete(key));
/** Wipe everything this app stored. Used by sign-out; tests use it to isolate cases. */
export async function resetKv() {
  await run('readwrite', (s) => s.clear());
}
