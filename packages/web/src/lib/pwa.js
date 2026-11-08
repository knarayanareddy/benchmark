/** Register the offline shell. The worker never caches /api/*: answers and tokens are not stored by it. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ });
  });
}
