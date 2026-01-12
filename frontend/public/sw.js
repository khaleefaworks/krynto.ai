/* Minimal service worker to satisfy PWA installability.
 *
 * Intentionally no caching yet (avoids surprising behavior for auth-protected data).
 * Push notifications will extend this worker in Phase 2.5.3.
 */

self.addEventListener('install', () => {
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim())
})

// Installability requires a fetch handler in Chromium.
self.addEventListener('fetch', () => {
    // No-op: let the network handle requests.
})
