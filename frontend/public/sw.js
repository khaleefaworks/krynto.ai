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

self.addEventListener('push', (event) => {
    let data = {}
    try {
        data = event.data ? event.data.json() : {}
    } catch {
        try {
            data = event.data ? { title: '', body: event.data.text() } : {}
        } catch {
            data = {}
        }
    }

    const title = String(data.title || 'New chat')
    const body = String(data.body || '')
    const url = String(data.url || '/')

    event.waitUntil(
        (async () => {
            try {
                const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

                // Always show an OS notification for a push event.
                await self.registration.showNotification(title, {
                    body,
                    icon: '/android-chrome-192x192.png',
                    badge: '/favicon-32x32.png',
                    data: { url },
                })

                // If the dashboard is already open, notify it so it can play a sound.
                // (Audio cannot be played directly from a service worker.)
                for (const client of allClients) {
                    client.postMessage({ type: 'push', title, body, url })
                }
            } catch {
                // ignore
            }
        })()
    )
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()

    const url = (event.notification && event.notification.data && event.notification.data.url) || '/'

    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            for (const client of allClients) {
                if ('focus' in client) {
                    await client.focus()
                    if ('navigate' in client) {
                        try {
                            await client.navigate(url)
                        } catch {
                            // ignore
                        }
                    }
                    return
                }
            }
            if (self.clients.openWindow) {
                await self.clients.openWindow(url)
            }
        })()
    )
})
