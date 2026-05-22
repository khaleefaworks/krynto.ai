/**
 * Service worker for AI ChatAssist PWA.
 *
 * Caching strategy:
 *  - App shell (/, manifest, icons): precached on install, served cache-first.
 *  - Static assets (/assets/, /sounds/, icon files): runtime cache-first.
 *  - Navigation requests: network-first, fallback to cached shell for offline UX.
 *  - API / auth requests: always network-only (never cached).
 *  - Push + notificationclick: handled below.
 */

const SHELL_CACHE = 'aica-shell-v1'
const STATIC_CACHE = 'aica-static-v1'
const KNOWN_CACHES = [SHELL_CACHE, STATIC_CACHE]

const SHELL_URLS = ['/', '/site.webmanifest']

// Patterns for files that are safe to cache long-term (content-hashed or static).
const STATIC_PATTERNS = [
    /\/assets\//,
    /\/sounds\//,
    /\/android-chrome-/,
    /\/apple-touch-icon/,
    /\/favicon/,
]

// Never cache these — auth-sensitive or always-fresh.
const SKIP_PATTERNS = [
    /\/api\//,
    /\/auth\//,
    /\/ws\//,
]

function isStaticAsset(url) {
    return STATIC_PATTERNS.some(p => p.test(url.pathname))
}

function shouldSkip(url) {
    if (url.hostname !== self.location.hostname) return true
    return SKIP_PATTERNS.some(p => p.test(url.pathname))
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
    self.skipWaiting()
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_URLS))
            .catch(() => { /* non-fatal */ })
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => !KNOWN_CACHES.includes(k))
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    )
})

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)

    // Only handle GET; skip auth/API/WS and cross-origin.
    if (event.request.method !== 'GET') return
    if (shouldSkip(url)) return

    // Static assets: cache-first (Vite bundles are content-hashed).
    if (isStaticAsset(url)) {
        event.respondWith(
            caches.open(STATIC_CACHE).then(async cache => {
                const cached = await cache.match(event.request)
                if (cached) return cached
                try {
                    const res = await fetch(event.request)
                    // Cache API rejects partial responses (HTTP 206 from range requests
                    // used by audio/video). Only cache full 200 responses.
                    if (res.ok && res.status !== 206) cache.put(event.request, res.clone())
                    return res
                } catch {
                    return cached || Response.error()
                }
            })
        )
        return
    }

    // Navigation (HTML): network-first, offline fallback to cached shell.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() =>
                caches.match('/').then(r => r || fetch(event.request))
            )
        )
        return
    }

    // Everything else (fonts, etc.): network-only.
})

// ─── Push ─────────────────────────────────────────────────────────────────────

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
    const pushType = String(data.push_type || 'new_message')   // "new_chat" | "new_message"

    // Use different tags per type so Android stacks them in separate notification groups.
    // Collapse rapid duplicates within the same type+url.
    const tag = pushType === 'new_chat'
        ? `aica:new_chat:${url.slice(0, 60)}`
        : `aica:new_message:${url.slice(0, 60)}`

    // Different vibration patterns help users feel the difference without unlocking.
    // new_chat: two short pulses (attention-grabbing)
    // new_message: one short pulse (subtle follow-up)
    const vibrate = pushType === 'new_chat' ? [120, 80, 120] : [80]

    event.waitUntil(
        (async () => {
            try {
                const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

                await self.registration.showNotification(title, {
                    body,
                    icon: '/android-chrome-192x192.png',
                    badge: '/favicon-32x32.png',
                    tag,
                    renotify: true,
                    vibrate,
                    data: { url, push_type: pushType },
                })

                // Forward to open tabs so they can play an in-app sound.
                // (Audio cannot be played directly from a service worker.)
                for (const client of allClients) {
                    client.postMessage({ type: 'push', title, body, url, push_type: pushType })
                }
            } catch {
                // ignore
            }
        })()
    )
})

// ─── Notification click ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
    event.notification.close()

    const url = (event.notification && event.notification.data && event.notification.data.url) || '/'

    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

            // Focus an existing tab at the target URL if one exists.
            for (const client of allClients) {
                if ('focus' in client) {
                    await client.focus()
                    if ('navigate' in client) {
                        try { await client.navigate(url) } catch { }
                    }
                    return
                }
            }

            // No open tab — open a new window.
            if (self.clients.openWindow) {
                await self.clients.openWindow(url)
            }
        })()
    )
})
