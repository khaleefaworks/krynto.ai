import { apiRequest } from './api'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

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

export async function ensurePushSubscription(): Promise<void> {
    if (!('serviceWorker' in navigator)) return
    if (!('PushManager' in window)) return
    if (!window.isSecureContext) return
    if (Notification.permission !== 'granted') return

    const registration = await navigator.serviceWorker.ready

    const existing = await registration.pushManager.getSubscription()
    if (existing) {
        await registerSubscription(existing)
        return
    }

    const publicKey = await getVapidPublicKey()
    if (!publicKey) return

    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    })

    await registerSubscription(subscription)
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
