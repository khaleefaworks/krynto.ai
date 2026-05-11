import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, BellOff, Volume2, Play, HelpCircle, RefreshCcw, AlertTriangle, Lock, Unlock, CheckCircle2 } from 'lucide-react'
import { getNotificationPermission, getVapidPublicKey, isPushSupported, requestPermissionAndSubscribe } from '@/services/push'
import { SOUND_PREF_KEYS, playNewVisitorNotificationSound, playMessageNotificationSound, playNewVisitorOnWebsiteSound, setNotificationAudioSink, ensureHardwareLabelsUnlocked } from '@/lib/notificationSound'
import { saveNotificationPreferences, fetchNotificationPreferences, syncPrefsToLocalStorage } from '@/services/notificationPrefs'

const SOUND_VERSION = '2024.04.29.v1' // Force update version

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
    const [pushWhenOffline, setPushWhenOffline] = useState(true)
    const [pushWhenOfflineSaving, setPushWhenOfflineSaving] = useState(false)

    // Sound preferences
    const [newChatSound, setNewChatSound] = useState(() => getSaved(SOUND_PREF_KEYS.newChat, 'alarm.mp3'))
    const [messageSound, setMessageSound] = useState(() => getSaved(SOUND_PREF_KEYS.message, 'blackberry2.mp3'))
    const [visitorSound, setVisitorSound] = useState(() => getSaved(SOUND_PREF_KEYS.newVisitorWebsite, 'simplesms.mp3'))
    
    const [sinkId, setSinkId] = useState(() => getSaved(SOUND_PREF_KEYS.sinkId, 'default'))
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
    const [isSinkSupported, setIsSinkSupported] = useState(true)
    const [sinkMissing, setSinkMissing] = useState(false)
    const [permissionLoading, setPermissionLoading] = useState(false)
    const [isUpToDate, setIsUpToDate] = useState(false)

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Force-update sound defaults once per agent
    useEffect(() => {
        const currentVersion = localStorage.getItem('notif_sound_cfg_ver')
        if (currentVersion !== SOUND_VERSION) {
            // Apply new system defaults to localStorage
            localStorage.setItem(SOUND_PREF_KEYS.newChat, 'alarm.mp3')
            localStorage.setItem(SOUND_PREF_KEYS.message, 'blackberry2.mp3')
            localStorage.setItem(SOUND_PREF_KEYS.newVisitorWebsite, 'simplesms.mp3')
            localStorage.setItem('notif_sound_cfg_ver', SOUND_VERSION)
            
            // Sync states
            setNewChatSound('alarm.mp3')
            setMessageSound('blackberry2.mp3')
            setVisitorSound('simplesms.mp3')
            
            // Also force-sync to API (preserve push_when_offline from localStorage)
            const _pwo = (() => { try { const v = localStorage.getItem('notif_push_when_offline'); return v !== null ? v !== 'false' : true } catch { return true } })()
            const prefs = {
                new_chat_sound: 'alarm.mp3',
                message_sound: 'blackberry2.mp3',
                new_visitor_website_sound: 'simplesms.mp3',
                push_when_offline: _pwo,
            }
            syncPrefsToLocalStorage(prefs)
            saveNotificationPreferences(prefs).catch(() => {})
        }
        setIsUpToDate(true)
    }, [])

    const refreshDevices = useCallback(async () => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                setIsSinkSupported(false)
                return
            }

            const audio = new Audio()
            if (typeof (audio as any).setSinkId !== 'function') {
                setIsSinkSupported(false)
            }

            const allDevices = await navigator.mediaDevices.enumerateDevices()
            const outputs = allDevices.filter(d => d.kind === 'audiooutput')
            setDevices(outputs)

            const savedSinkId = localStorage.getItem(SOUND_PREF_KEYS.sinkId) || 'default'
            
            if (savedSinkId === 'default' && outputs.length > 0) {
                const builtIn = outputs.find(d => 
                    d.label.toLowerCase().includes('built-in audio') || 
                    d.label.toLowerCase().includes('analog stereo')
                )
                if (builtIn) {
                    setSinkId(builtIn.deviceId)
                    setNotificationAudioSink(builtIn.deviceId)
                    setSinkMissing(false)
                    return 
                }
            }

            if (savedSinkId !== 'default' && outputs.length > 0) {
                if (!outputs.some(d => d.deviceId === savedSinkId)) {
                    setSinkMissing(true)
                } else {
                    setSinkMissing(false)
                }
            } else {
                setSinkMissing(false)
            }
        } catch (err) {
            console.error('Failed to list audio devices:', err)
        }
    }, [])

    useEffect(() => {
        refreshDevices()
        
        if (typeof navigator !== 'undefined' && (navigator as any).permissions && (navigator as any).permissions.query) {
            (navigator as any).permissions.query({ name: 'microphone' }).then((status: any) => {
                if (status.state === 'granted') {
                    ensureHardwareLabelsUnlocked().then(() => refreshDevices())
                }
                status.onchange = () => {
                    if (status.state === 'granted') {
                        ensureHardwareLabelsUnlocked().then(() => refreshDevices())
                    }
                }
            }).catch(() => {})
        }
    }, [refreshDevices])

    const handleSoundChange = useCallback((key: keyof typeof SOUND_PREF_KEYS, value: string) => {
        try { localStorage.setItem(SOUND_PREF_KEYS[key], value) } catch { }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            const pwo = (() => { try { const v = localStorage.getItem('notif_push_when_offline'); return v !== null ? v !== 'false' : true } catch { return true } })()
            const prefs = {
                new_chat_sound: key === 'newChat' ? value : (localStorage.getItem(SOUND_PREF_KEYS.newChat) ?? 'alarm.mp3'),
                message_sound: key === 'message' ? value : (localStorage.getItem(SOUND_PREF_KEYS.message) ?? 'blackberry2.mp3'),
                new_visitor_website_sound: key === 'newVisitorWebsite' ? value : (localStorage.getItem(SOUND_PREF_KEYS.newVisitorWebsite) ?? 'simplesms.mp3'),
                push_when_offline: pwo,
            }
            syncPrefsToLocalStorage(prefs)
            saveNotificationPreferences(prefs).catch(() => { })
        }, 800)
    }, [])

    const handleSinkChange = async (newSinkId: string) => {
        if (newSinkId === '__missing__') return
        setSinkId(newSinkId)
        setSinkMissing(false)
        await setNotificationAudioSink(newSinkId)
        playMessageNotificationSound()
    }

    useEffect(() => {
        if (!sinkMissing) return
        setSinkId('default')
        setSinkMissing(false)
        setNotificationAudioSink('default').catch(() => { })
    }, [sinkMissing])

    const requestHardwarePermission = async () => {
        setPermissionLoading(true)
        try {
            await ensureHardwareLabelsUnlocked()
            await refreshDevices()
            setMessage({ type: 'success', text: 'Hardware labels unlocked.' })
        } catch (err) {
            console.error('Permission denied:', err)
            setMessage({ type: 'error', text: 'Permission denied. Could not unlock device labels.' })
        } finally {
            setPermissionLoading(false)
        }
    }

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

    // Load push_when_offline preference from server on mount
    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    const prefs = await fetchNotificationPreferences()
                    if (!cancelled) setPushWhenOffline(prefs.push_when_offline)
                } catch {
                    // keep default true
                }
            })()
        return () => { cancelled = true }
    }, [])

    const handlePushWhenOfflineToggle = async (value: boolean) => {
        setPushWhenOffline(value)
        setPushWhenOfflineSaving(true)
        try {
            const current = {
                new_chat_sound: localStorage.getItem(SOUND_PREF_KEYS.newChat) ?? 'alarm.mp3',
                message_sound: localStorage.getItem(SOUND_PREF_KEYS.message) ?? 'blackberry2.mp3',
                new_visitor_website_sound: localStorage.getItem(SOUND_PREF_KEYS.newVisitorWebsite) ?? '',
                push_when_offline: value,
            }
            await saveNotificationPreferences(current)
            try { localStorage.setItem('notif_push_when_offline', String(value)) } catch { }
        } catch {
            setPushWhenOffline(!value) // revert on failure
            setMessage({ type: 'error', text: 'Failed to save preference.' })
        } finally {
            setPushWhenOfflineSaving(false)
        }
    }

    const pushGranted = pushPermission === 'granted'
    const pushReady = isPushSupported() && vapidPublicKeyPresent !== false

    const handleEnablePush = async () => {
        setPushLoading(true)
        try {
            ensureHardwareLabelsUnlocked()
            const perm = await requestPermissionAndSubscribe()
            setPushPermission(perm)
            if (perm === 'granted') {
                setMessage({ type: 'success', text: 'Browser notifications enabled.' })
            } else if (perm === 'denied') {
                setMessage({ type: 'error', text: 'Notifications were blocked in the browser.' })
            } else {
                setMessage({ type: 'error', text: 'Notifications permission was not granted.' })
            }
            await refreshDevices()
        } catch (e: any) {
            setMessage({ type: 'error', text: e?.message || 'Failed to enable notifications' })
        } finally {
            setPushLoading(false)
        }
    }

    const hasLabels = devices.length > 0 && devices.some(d => !!d.label)

    return (
        <div className="flex flex-col h-full">
            <div className="h-16 flex items-center border-b dark:border-gray-700 px-6 flex-shrink-0 justify-between">
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

                        {/* Notify when offline toggle — shown only when push is granted */}
                        {pushGranted && (
                            <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50">
                                <div className="flex items-center justify-between gap-4 px-4 py-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Bell className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">Notify when offline</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Receive push notifications even when your status is set to offline</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={pushWhenOffline}
                                        disabled={pushWhenOfflineSaving}
                                        onClick={() => handlePushWhenOfflineToggle(!pushWhenOffline)}
                                        className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 ${pushWhenOffline ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${pushWhenOffline ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ─── Audio Output Device ─── */}
                    {isSinkSupported && (
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Audio Output Device</h3>
                                <div className="flex items-center gap-2">
                                    {!hasLabels && (
                                        <button
                                            onClick={requestHardwarePermission}
                                            disabled={permissionLoading}
                                            className="text-[10px] font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 uppercase tracking-tighter px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 transition-all"
                                        >
                                            {permissionLoading ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />}
                                            Unlock Names
                                        </button>
                                    )}
                                    <button
                                        onClick={refreshDevices}
                                        className="text-gray-400 hover:text-blue-500 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                                        title="Refresh device list"
                                    >
                                        <RefreshCcw className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                    Force notification sounds to specific speakers.
                                </p>
                                <select
                                    value={sinkMissing ? '__missing__' : sinkId}
                                    onChange={(e) => handleSinkChange(e.target.value)}
                                    className={`w-full rounded-lg border bg-white dark:bg-gray-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${sinkMissing
                                        ? 'border-amber-300 dark:border-amber-600 text-amber-900 dark:text-amber-100'
                                        : 'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100'
                                        }`}
                                >
                                    <option value="default">Default System Output</option>
                                    {sinkMissing && <option value="__missing__" disabled>(Device unplugged)</option>}
                                    {devices.map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {d.label || `Unknown Device (${d.deviceId.slice(0, 5)}...)`}
                                        </option>
                                    ))}
                                </select>
                                
                                {sinkMissing && (
                                    <div className="mt-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-tight">
                                            Selected device not available. Switched to default output.
                                        </p>
                                    </div>
                                )}

                                {!hasLabels && (
                                    <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 leading-tight">
                                        Note: Device names are locked by the browser. Click <strong>Unlock Names</strong> above and select "Allow" to enable hardware identification.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

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
