import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, BellOff, Volume2, Play, HelpCircle } from 'lucide-react'
import { getNotificationPermission, getVapidPublicKey, isPushSupported, requestPermissionAndSubscribe } from '@/services/push'
import { SOUND_PREF_KEYS, playNewVisitorNotificationSound, playMessageNotificationSound, playNewVisitorOnWebsiteSound } from '@/lib/notificationSound'
import { saveNotificationPreferences, syncPrefsToLocalStorage } from '@/services/notificationPrefs'

// All available dashboard notification sounds
const DASHBOARD_SOUNDS = [
    { value: '', label: '--- (silent)' },
    { value: 'alarm.mp3', label: 'Alarm' },
    { value: 'blackberry.mp3', label: 'Blackberry' },
    { value: 'blackberry2.mp3', label: 'Blackberry 2' },
    { value: 'echo.mp3', label: 'Echo' },
    { value: 'message-bells.mp3', label: 'Bells' },
    { value: 'message.mp3', label: 'Message' },
    { value: 'msn-message.mp3', label: 'MSN Message' },
    { value: 'msn-nudge.mp3', label: 'MSN Nudge' },
    { value: 'new-notification.mp3', label: 'Notification (new)' },
    { value: 'notification.mp3', label: 'Notification' },
    { value: 'simplesms.mp3', label: 'Simple' },
    { value: 'windows7.mp3', label: 'Windows 7' },
]

function getSaved(key: string, fallback: string): string {
    try {
        const v = localStorage.getItem(key)
        return v !== null ? v : fallback
    } catch {
        return fallback
    }
}

function SoundRow({
    label,
    hint,
    value,
    onChange,
    onPreview,
}: {
    label: string
    hint?: string
    value: string
    onChange: (v: string) => void
    onPreview: () => void
}) {
    return (
        <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</label>
            {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{hint}</p>}
            <div className="flex items-center gap-2">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                    {DASHBOARD_SOUNDS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={onPreview}
                    title="Preview sound"
                    disabled={!value}
                    className="flex-shrink-0 h-9 w-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    <Play className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    )
}

export default function NotificationSettings() {
    const [pushLoading, setPushLoading] = useState(false)
    const [pushPermission, setPushPermission] = useState<ReturnType<typeof getNotificationPermission>>(
        typeof window !== 'undefined' ? getNotificationPermission() : 'unsupported'
    )
    const [vapidPublicKeyPresent, setVapidPublicKeyPresent] = useState<boolean | null>(null)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    // Sound preferences — lifted to parent so we can batch-save to API
    const [newChatSound, setNewChatSound] = useState(() => getSaved(SOUND_PREF_KEYS.newChat, 'new-notification.mp3'))
    const [messageSound, setMessageSound] = useState(() => getSaved(SOUND_PREF_KEYS.message, 'notification.mp3'))
    const [visitorSound, setVisitorSound] = useState(() => getSaved(SOUND_PREF_KEYS.newVisitorWebsite, ''))
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Debounced save: write to localStorage immediately, persist to API after 800 ms idle.
    const handleSoundChange = useCallback((key: keyof typeof SOUND_PREF_KEYS, value: string) => {
        try { localStorage.setItem(SOUND_PREF_KEYS[key], value) } catch { }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            const prefs = {
                new_chat_sound: key === 'newChat' ? value : (localStorage.getItem(SOUND_PREF_KEYS.newChat) ?? 'new-notification.mp3'),
                message_sound: key === 'message' ? value : (localStorage.getItem(SOUND_PREF_KEYS.message) ?? 'notification.mp3'),
                new_visitor_website_sound: key === 'newVisitorWebsite' ? value : (localStorage.getItem(SOUND_PREF_KEYS.newVisitorWebsite) ?? ''),
            }
            syncPrefsToLocalStorage(prefs)
            saveNotificationPreferences(prefs).catch(() => { })
        }, 800)
    }, [])

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    const key = await getVapidPublicKey()
                    if (!cancelled) setVapidPublicKeyPresent(Boolean(key))
                } catch {
                    if (!cancelled) setVapidPublicKeyPresent(false)
                }
            })()
        return () => { cancelled = true }
    }, [])

    const pushGranted = pushPermission === 'granted'
    const pushReady = isPushSupported() && vapidPublicKeyPresent !== false

    const handleEnablePush = async () => {
        setPushLoading(true)
        try {
            const perm = await requestPermissionAndSubscribe()
            setPushPermission(perm)
            if (perm === 'granted') {
                setMessage({ type: 'success', text: 'Browser notifications enabled.' })
            } else if (perm === 'denied') {
                setMessage({ type: 'error', text: 'Notifications were blocked in the browser.' })
            } else {
                setMessage({ type: 'error', text: 'Notifications permission was not granted.' })
            }
        } catch (e: any) {
            setMessage({ type: 'error', text: e?.message || 'Failed to enable notifications' })
        } finally {
            setPushLoading(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="h-16 flex items-center border-b dark:border-gray-700 px-6 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Notifications</h1>
                    <a href="/docs/agent-guide/notifications" target="_blank" rel="noreferrer" title="View notifications guide" className="text-gray-400 hover:text-blue-500 transition-colors">
                        <HelpCircle className="w-4 h-4" />
                    </a>
                </div>
            </div>

            <div className="flex-1 overflow-auto py-8">
                <div className="max-w-xl w-full mx-auto px-6 space-y-8">

                    {message && (
                        <div className={`p-3 rounded-lg text-sm ${message.type === 'success'
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                            }`}>
                            {message.text}
                        </div>
                    )}

                    {/* ─── Desktop Notifications ─── */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Desktop Notifications</h3>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50">
                            <div className="flex items-center justify-between gap-4 px-4 py-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    {pushGranted
                                        ? <Bell className="h-4 w-4 text-green-500 flex-shrink-0" />
                                        : <BellOff className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                    }
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">Browser Notifications</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Get OS-level alerts when new chats arrive while the tab is in the background</p>
                                    </div>
                                </div>
                                {pushGranted ? (
                                    <span className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-900/30 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-300">
                                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                                        On
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleEnablePush}
                                        disabled={pushLoading || !pushReady}
                                        className="flex-shrink-0 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {pushLoading ? 'Enabling…' : 'Enable'}
                                    </button>
                                )}
                            </div>
                        </div>
                        {!isPushSupported() && (
                            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Your browser doesn't support push notifications.</p>
                        )}
                        {vapidPublicKeyPresent === false && (
                            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Push unavailable — server VAPID keys not configured.</p>
                        )}
                        {pushPermission === 'denied' && (
                            <p className="mt-2 text-xs text-red-600 dark:text-red-400">Blocked in browser settings. Update site permissions to allow.</p>
                        )}
                    </div>

                    {/* ─── Sound Notifications ─── */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Sound Notifications</h3>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 divide-y divide-gray-100 dark:divide-gray-700/60">

                            <div className="px-4 py-4">
                                <SoundRow
                                    label="New chat"
                                    hint="Plays when a visitor opens a new conversation"
                                    value={newChatSound}
                                    onChange={(v) => { setNewChatSound(v); handleSoundChange('newChat', v) }}
                                    onPreview={playNewVisitorNotificationSound}
                                />
                            </div>

                            <div className="px-4 py-4">
                                <SoundRow
                                    label="New message (in active chat)"
                                    hint="Plays when a visitor sends a message in an ongoing conversation"
                                    value={messageSound}
                                    onChange={(v) => { setMessageSound(v); handleSoundChange('message', v) }}
                                    onPreview={playMessageNotificationSound}
                                />
                            </div>

                            <div className="px-4 py-4">
                                <SoundRow
                                    label="New visitor on website"
                                    hint="Plays only when you are on the Customers → Visitors page"
                                    value={visitorSound}
                                    onChange={(v) => { setVisitorSound(v); handleSoundChange('newVisitorWebsite', v) }}
                                    onPreview={playNewVisitorOnWebsiteSound}
                                />
                            </div>

                        </div>
                    </div>

                </div>
            </div>
        </div>
    )
}
