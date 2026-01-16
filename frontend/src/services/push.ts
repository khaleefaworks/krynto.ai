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

export async function ensurePushSubscription(): Promise<void> {
    if (!('serviceWorker' in navigator)) return
    if (!('PushManager' in window)) return
    if (!window.isSecureContext) return
    if (Notification.permission !== 'granted') return

    const registration = await navigator.serviceWorker.ready

    const publicKey = await getVapidPublicKey()
    if (!publicKey) return

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
