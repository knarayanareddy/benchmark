/* Offline shell. The cache name and file list are filled in at build time (vite.config.js).
 *
 * Privacy: this worker NEVER touches /api/*. No answer, token, ballot or inbox is cached by
 * it, and nothing it caches is personal: only the app's own scripts, styles and icons. */
const VERSION = '__VERSION__';
const CACHE = `shell-${VERSION}`;
const PRECACHE = JSON.parse('__PRECACHE__');

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // Pages: network first (so a deploy is seen), the cached page when offline.
    const page = url.pathname.startsWith('/staff') ? '/staff.html' : '/index.html';
    event.respondWith(fetch(req).catch(() => caches.match(page)));
    return;
  }
  // Built assets are content-hashed, so cache first is safe.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
