import { apiRequest } from './api'
import { API_BASE } from '../config/endpoints'

const _VAPID_PUBLIC_KEY_CACHE = 'push_vapid_public_key_v1'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
    }

    return outputArray
}

export async function getVapidPublicKey(): Promise<string> {
    const res = await fetch(`${API_BASE}/push/vapid-public-key`)
    const data = await res.json().catch(() => ({}))
    return String(data?.public_key || '').trim()
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
    if (!('Notification' in window)) return 'unsupported'
    return Notification.permission
}

export function isPushSupported(): boolean {
    return (
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window &&
        window.isSecureContext
    )
}

export async function requestPermissionAndSubscribe(): Promise<NotificationPermission | 'unsupported'> {
    if (!('Notification' in window)) return 'unsupported'
    if (!isPushSupported()) return Notification.permission

    const perm = await Notification.requestPermission()
    if (perm === 'granted') {
        await ensurePushSubscription()
    }
    return perm
}

// Last subscription error, surfaced in the Notifications settings UI.
let _lastSubscriptionError: string | null = null

export function getLastPushSubscriptionError(): string | null {
    return _lastSubscriptionError
}

export async function ensurePushSubscription(): Promise<void> {
    _lastSubscriptionError = null

    if (!('serviceWorker' in navigator)) {
        _lastSubscriptionError = 'Service workers are not supported in this browser.'
        return
    }
    if (!('PushManager' in window)) {
        _lastSubscriptionError = 'Web Push is not supported in this browser.'
        return
    }
    if (!window.isSecureContext) {
        _lastSubscriptionError = 'Push notifications require a secure context (HTTPS or localhost).'
        return
    }
    if (Notification.permission !== 'granted') return

    try {
        const registration = await navigator.serviceWorker.ready

        const publicKey = await getVapidPublicKey()
        if (!publicKey) {
            _lastSubscriptionError = 'Push configuration is missing on the server (VAPID key not set).'
            return
        }

        // If the backend VAPID key changes, any existing subscription was created with the
        // old applicationServerKey. In that case we must unsubscribe + resubscribe.
        let cachedKey: string | null = null
        try {
            cachedKey = localStorage.getItem(_VAPID_PUBLIC_KEY_CACHE)
        } catch {
            cachedKey = null
        }

        const existing = await registration.pushManager.getSubscription()
        if (existing && cachedKey && cachedKey !== publicKey) {
            try {
                await existing.unsubscribe()
            } catch {
                // best-effort
            }
        } else if (existing) {
            await registerSubscription(existing)
            try {
                localStorage.setItem(_VAPID_PUBLIC_KEY_CACHE, publicKey)
            } catch {
                // ignore
            }
            return
        }

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        })

        await registerSubscription(subscription)

        try {
            localStorage.setItem(_VAPID_PUBLIC_KEY_CACHE, publicKey)
        } catch {
            // ignore
        }
    } catch (err: any) {
        // Surface the error so the settings UI can show actionable guidance.
        const msg = String(err?.message || err || 'Unknown error')
        _lastSubscriptionError = msg
        // Re-throw so callers like App.tsx that use .catch() still see it.
        throw err
    }
}

export async function registerSubscription(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON() as any

    const endpoint = String(json?.endpoint || '').trim()
    const p256dh = String(json?.keys?.p256dh || '').trim()
    const auth = String(json?.keys?.auth || '').trim()

    if (!endpoint || !p256dh || !auth) return

    await apiRequest('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint, keys: { p256dh, auth } }),
    })
}

/**
 * Unsubscribe from push notifications.
 * Calls the server to remove the subscription row, then unsubscribes the browser channel.
 * Must be called BEFORE the auth token is cleared (server needs it to authenticate).
 */
export async function unsubscribeFromPush(): Promise<void> {
    if (!('serviceWorker' in navigator)) return
    try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (!subscription) return

        const json = subscription.toJSON() as any
        const endpoint = String(json?.endpoint || '').trim()
        const p256dh = String(json?.keys?.p256dh || '').trim()
        const auth = String(json?.keys?.auth || '').trim()

        // Tell server to delete the row first — do this while auth token is still valid.
        if (endpoint && p256dh && auth) {
            await apiRequest('/push/unsubscribe', {
                method: 'POST',
                body: JSON.stringify({ endpoint, keys: { p256dh, auth } }),
            }).catch(() => {})  // best-effort
        }

        // Remove the browser-level push channel.
        await subscription.unsubscribe().catch(() => {})
    } catch {
        // best-effort — never let this block logout
    }
}
