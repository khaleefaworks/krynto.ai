import { apiRequest } from './api'
import { SOUND_PREF_KEYS } from '@/lib/notificationSound'

export interface NotificationPreferences {
    new_chat_sound: string
    message_sound: string
    new_visitor_website_sound: string
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
    return apiRequest<NotificationPreferences>('/users/me/notification-preferences')
}

export async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
    await apiRequest<NotificationPreferences>('/users/me/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
    })
}

/** Write API preferences into localStorage so notificationSound.ts picks them up immediately. */
export function syncPrefsToLocalStorage(prefs: NotificationPreferences): void {
    try {
        localStorage.setItem(SOUND_PREF_KEYS.newChat, prefs.new_chat_sound)
        localStorage.setItem(SOUND_PREF_KEYS.message, prefs.message_sound)
        localStorage.setItem(SOUND_PREF_KEYS.newVisitorWebsite, prefs.new_visitor_website_sound)
    } catch {
        // ignore (private browsing, storage full, etc.)
    }
}

/** Read current localStorage values into the API shape. */
export function readPrefsFromLocalStorage(): NotificationPreferences {
    const get = (key: string, fallback: string) => {
        try { const v = localStorage.getItem(key); return v !== null ? v : fallback } catch { return fallback }
    }
    return {
        new_chat_sound: get(SOUND_PREF_KEYS.newChat, 'new-notification.mp3'),
        message_sound: get(SOUND_PREF_KEYS.message, 'notification.mp3'),
        new_visitor_website_sound: get(SOUND_PREF_KEYS.newVisitorWebsite, ''),
    }
}
