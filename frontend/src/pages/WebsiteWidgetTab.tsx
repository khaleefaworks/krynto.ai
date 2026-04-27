import { useState, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { Image, Palette, ToggleRight, Upload, MessageCircle, Sparkles, Bell, AlignLeft, AlignRight, Volume2, Play, HelpCircle } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'

/* ── Types ────────────────────────────────────────────── */

interface WidgetConfig {
    theme?: string
    position?: string
    welcome_message?: string
    primary_color?: string
    color_mode?: 'solid' | 'gradient'
    gradient_start?: string
    gradient_end?: string
    header_title?: string
    online_status_text?: string
    bubble_text?: string
    show_emoji_picker?: boolean
    show_attachments?: boolean
    branding_text?: string | null
    header_icon_url?: string | null
    popup_name?: string
    popup_button_text?: string
    notification_sound_collapsed?: string
    notification_sound_opened?: string
}

interface WebsiteWidgetTabProps {
    widgetConfig: WidgetConfig
    websiteId: number
    saving: boolean
    showConversationHistory: boolean
    onConfigChange: (config: WidgetConfig) => void
    onUploadIcon: (file: File) => void
    onShowConversationHistoryChange: (v: boolean) => void
}

/* ── Constants ────────────────────────────────────────── */

const GRADIENT_PRESETS = [
    { start: '#3b82f6', end: '#2563eb' },
    { start: '#ef4444', end: '#dc2626' },
    { start: '#f97316', end: '#ea580c' },
    { start: '#22c55e', end: '#16a34a' },
    { start: '#0ea5e9', end: '#0284c7' },
    { start: '#8b5cf6', end: '#7c3aed' },
    { start: '#ec4899', end: '#db2777' },
    { start: '#14b8a6', end: '#0d9488' },
    { start: '#6366f1', end: '#4f46e5' },
    { start: '#111827', end: '#374151' },
]

const SOLID_PRESETS = [
    '#3b82f6', '#ef4444', '#f97316', '#22c55e', '#0ea5e9',
    '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1', '#111827',
]

/* ── Section wrapper ──────────────────────────────────── */

function Section({ icon: Icon, title, description, children }: {
    icon: React.ElementType
    title: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </div>
                <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
                    {description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</p>}
                </div>
            </div>
            <div className="px-5 py-4 space-y-4">{children}</div>
        </div>
    )
}

/* ── Field row ────────────────────────────────────────── */

function Field({ label, hint, children }: {
    label: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">{label}</label>
            {children}
            {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{hint}</p>}
        </div>
    )
}

/* ── Widget Window Preview ────────────────────────────── */

function WidgetPreview({ config }: { config: WidgetConfig }) {
    const headerBg =
        config.color_mode === 'gradient'
            ? `linear-gradient(135deg, ${config.gradient_start || '#3b82f6'} 0%, ${config.gradient_end || '#2563eb'} 100%)`
            : config.primary_color || '#3b82f6'
    const accentBg =
        config.color_mode === 'gradient'
            ? `linear-gradient(135deg, ${config.gradient_start || '#3b82f6'} 0%, ${config.gradient_end || '#2563eb'} 100%)`
            : config.primary_color || '#3b82f6'
    const isDark = config.theme === 'dark'
    const isLeft = config.position === 'bottom-left'

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Widget Preview</p>
            </div>
            <div className="p-5">
                {/* Simulated page background */}
                <div className="relative rounded-xl bg-gray-100 dark:bg-gray-900/60 overflow-hidden" style={{ minHeight: 320 }}>
                    {/* Fake page lines */}
                    <div className="p-4 space-y-2 opacity-30">
                        {[80, 60, 70, 50, 65].map((w, i) => (
                            <div key={i} className={`h-2 rounded bg-gray-400 dark:bg-gray-600`} style={{ width: `${w}%` }} />
                        ))}
                    </div>

                    {/* Widget window positioned at bottom */}
                    <div
                        className="absolute bottom-16"
                        style={{ [isLeft ? 'left' : 'right']: 12, width: 230 }}
                    >
                        <div className="rounded-2xl overflow-hidden shadow-xl border border-gray-200/60 dark:border-gray-600/40">
                            {/* Header */}
                            <div className="px-3 py-2.5 flex items-center gap-2.5" style={{ background: headerBg }}>
                                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                                    {config.header_icon_url ? (
                                        <img src={`${API_BASE}${config.header_icon_url}`} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <MessageCircle className="w-3.5 h-3.5 text-white/80" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-white text-[11px] font-semibold truncate leading-tight">
                                        {config.header_title || 'How can we help?'}
                                    </p>
                                    <p className="text-white/70 text-[9px] truncate mt-0.5">
                                        {config.online_status_text || 'We reply immediately'}
                                    </p>
                                </div>
                                {/* Close / minimize dots */}
                                <div className="flex gap-1 flex-shrink-0">
                                    <div className="w-3 h-3 rounded-full bg-white/20" />
                                    <div className="w-3 h-3 rounded-full bg-white/20" />
                                </div>
                            </div>

                            {/* Chat body */}
                            <div className={`px-3 pt-3 pb-2 space-y-2 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
                                {/* Bot message */}
                                <div className="flex gap-1.5">
                                    <div className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 ${isDark ? 'bg-gray-700' : 'bg-gray-300'}`} />
                                    <div className={`max-w-[75%] rounded-xl px-2.5 py-1.5 text-[9px] leading-relaxed ${isDark ? 'bg-gray-800 text-gray-200' : 'bg-white text-gray-700 shadow-sm'}`}>
                                        Hi! How can we help?
                                    </div>
                                </div>
                                {/* Visitor message */}
                                <div className="flex justify-end">
                                    <div className="max-w-[75%] rounded-xl px-2.5 py-1.5 text-[9px] leading-relaxed text-white" style={{ background: accentBg }}>
                                        I have a question
                                    </div>
                                </div>
                            </div>

                            {/* Input bar */}
                            <div className={`px-2.5 py-2 border-t flex items-center gap-1.5 ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100'}`}>
                                <div className={`flex-1 h-6 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`} />
                                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: accentBg }}>
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                                    </svg>
                                </div>
                            </div>

                            {/* Branding */}
                            {config.branding_text && (
                                <div className={`text-center py-1 text-[7px] ${isDark ? 'bg-gray-900 text-gray-600' : 'bg-white text-gray-400'}`}>
                                    {config.branding_text}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bubble */}
                    <div
                        className="absolute bottom-3"
                        style={{ [isLeft ? 'left' : 'right']: 12 }}
                    >
                        <div
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-white text-[10px] font-semibold shadow-lg"
                            style={{ background: accentBg }}
                        >
                            <MessageCircle className="w-3 h-3" />
                            {config.bubble_text || 'Chat'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

/* ── Chat Popup Preview ───────────────────────────────── */

function PopupPreview({ config }: { config: WidgetConfig }) {
    const accentBg =
        config.color_mode === 'gradient'
            ? `linear-gradient(135deg, ${config.gradient_start || '#3b82f6'} 0%, ${config.gradient_end || '#2563eb'} 100%)`
            : config.primary_color || '#3b82f6'
    const isLeft = config.position === 'bottom-left'
    const popupName = config.popup_name || 'Support'
    const buttonText = config.popup_button_text || 'Reply'
    const initials = popupName.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'S'

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Bell className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notification Popup Preview</p>
            </div>
            <div className="p-5">
                {/* Simulated page background */}
                <div className="relative rounded-xl bg-gray-100 dark:bg-gray-900/60 overflow-hidden" style={{ minHeight: 180 }}>
                    {/* Fake page lines */}
                    <div className="p-4 space-y-2 opacity-30">
                        {[80, 60, 70].map((w, i) => (
                            <div key={i} className="h-2 rounded bg-gray-400 dark:bg-gray-600" style={{ width: `${w}%` }} />
                        ))}
                    </div>

                    {/* Popup card */}
                    <div
                        className="absolute bottom-11"
                        style={{ [isLeft ? 'left' : 'right']: 10, width: 200 }}
                    >
                        <div className="bg-white rounded-2xl shadow-xl overflow-hidden" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
                            {/* Popup header row */}
                            <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                                {config.header_icon_url ? (
                                    <img
                                        src={`${API_BASE}${config.header_icon_url}`}
                                        alt={popupName}
                                        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                                    />
                                ) : (
                                    <div
                                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[9px] font-bold"
                                        style={{ background: accentBg }}
                                    >
                                        {initials}
                                    </div>
                                )}
                                <span className="flex-1 text-[10px] font-semibold text-gray-800 truncate">{popupName}</span>
                                <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-2 h-2 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </div>
                            </div>
                            {/* Message body */}
                            <p className="px-3 pb-2 text-[9px] text-gray-500 leading-relaxed">
                                Hey there! We're here if you have any questions.
                            </p>
                            {/* Reply button */}
                            <div className="px-3 pb-3">
                                <div
                                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-full text-white text-[9px] font-semibold"
                                    style={{ background: accentBg }}
                                >
                                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                    {buttonText}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bubble hint */}
                    <div
                        className="absolute bottom-3"
                        style={{ [isLeft ? 'left' : 'right']: 10 }}
                    >
                        <div
                            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-white text-[9px] font-semibold shadow"
                            style={{ background: accentBg }}
                        >
                            <MessageCircle className="w-2.5 h-2.5" />
                            {config.bubble_text || 'Chat'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

/* ── Position Picker ──────────────────────────────────── */

function PositionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const opts = [
        { value: 'bottom-left', icon: AlignLeft, label: 'Bottom Left' },
        { value: 'bottom-right', icon: AlignRight, label: 'Bottom Right' },
    ]
    return (
        <div className="grid grid-cols-2 gap-2">
            {opts.map(({ value: v, icon: Icon, label }) => (
                <button
                    key={v}
                    type="button"
                    onClick={() => onChange(v)}
                    className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-medium transition-all
                        ${value === v
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/40'
                        }`}
                >
                    <Icon className="w-4 h-4" />
                    {label}
                </button>
            ))}
        </div>
    )
}

/* ── Main component ───────────────────────────────────── */

export default function WebsiteWidgetTab({
    widgetConfig,
    websiteId: _websiteId,
    saving,
    showConversationHistory,
    onConfigChange,
    onUploadIcon,
    onShowConversationHistoryChange,
}: WebsiteWidgetTabProps) {
    const { user } = useAppStore()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver] = useState(false)

    const update = useCallback(
        (patch: Partial<WidgetConfig>) => onConfigChange({ ...widgetConfig, ...patch }),
        [widgetConfig, onConfigChange],
    )

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file?.type.startsWith('image/')) onUploadIcon(file)
        },
        [onUploadIcon],
    )

    const isGradient = widgetConfig.color_mode === 'gradient'

    return (
        <div className="space-y-6">
            {/* Page heading */}
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">Widget Customization</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Configure how the chat widget looks and behaves on your site.
                    </p>
                </div>
                <a href="/docs/widget/customisation" target="_blank" rel="noreferrer" title="View widget customisation guide" className="mt-0.5 text-gray-400 hover:text-blue-500 transition-colors flex-shrink-0">
                    <HelpCircle className="w-4 h-4" />
                </a>
            </div>

            {/* Two-column layout: config left, previews right */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6 items-start">

                {/* ── Left: Configuration ── */}
                <div className="space-y-5">

                    {/* ── 1. Appearance ── */}
                    <Section icon={Image} title="Appearance" description="Visual theme, position, and brand icon">

                        {/* Theme */}
                        <Field label="Theme">
                            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 w-fit">
                                {(['dark', 'light'] as const).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => update({ theme: t })}
                                        className={`px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${widgetConfig.theme === t
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                            }`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </Field>

                        {/* Position */}
                        <Field label="Position" hint="Where the widget appears on your site">
                            <PositionPicker
                                value={widgetConfig.position || 'bottom-right'}
                                onChange={(v) => update({ position: v })}
                            />
                        </Field>

                        {/* Header icon upload */}
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Header Icon</label>
                            <div className="flex items-start gap-4">
                                {isAdmin(user) ? (
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`relative w-20 h-20 rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-1 transition-all ${dragOver
                                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50 dark:bg-gray-900'
                                            }`}
                                    >
                                        {widgetConfig.header_icon_url ? (
                                            <img src={`${API_BASE}${widgetConfig.header_icon_url}`} alt="Widget icon" className="w-full h-full object-cover rounded-[10px]" />
                                        ) : (
                                            <>
                                                <Upload className="w-4 h-4 text-gray-400" />
                                                <span className="text-[10px] text-gray-400">Upload</span>
                                            </>
                                        )}
                                        <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadIcon(f); e.currentTarget.value = '' }} className="hidden" disabled={saving} />
                                    </div>
                                ) : (
                                    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                                        {widgetConfig.header_icon_url ? (
                                            <img src={`${API_BASE}${widgetConfig.header_icon_url}`} alt="Widget icon" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-[10px] text-gray-400">None</span>
                                        )}
                                    </div>
                                )}
                                <div className="pt-1">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Drag & drop or click to upload.</p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Shown in header and notification popup.</p>
                                </div>
                            </div>
                        </div>
                    </Section>

                    {/* ── 2. Header ── */}
                    <Section icon={MessageCircle} title="Header" description="Text shown at the top of the chat window">
                        <Field label="Title" hint="Main heading in the widget header">
                            <Input
                                value={widgetConfig.header_title || ''}
                                onChange={(e) => update({ header_title: e.target.value })}
                                placeholder="How can we help?"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>
                        <Field label="Status Text" hint="Shown below the title (e.g. response speed)">
                            <Input
                                value={widgetConfig.online_status_text || ''}
                                onChange={(e) => update({ online_status_text: e.target.value })}
                                placeholder="We reply immediately"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>
                    </Section>

                    {/* ── 3. Bubble ── */}
                    <Section icon={MessageCircle} title="Chat Bubble" description="The minimized button visitors click to open the chat">
                        <Field label="Bubble Text" hint="Label shown on the chat bubble button">
                            <Input
                                value={widgetConfig.bubble_text || ''}
                                onChange={(e) => update({ bubble_text: e.target.value })}
                                placeholder="Chat with us"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>
                    </Section>

                    {/* ── 4. Notification Popup ── */}
                    <Section icon={Bell} title="Notification Popup" description="The popup that appears above the bubble when a new message arrives">
                        <Field label="Sender Name" hint="Name shown in the popup header (default: Support)">
                            <Input
                                value={widgetConfig.popup_name || ''}
                                onChange={(e) => update({ popup_name: e.target.value })}
                                placeholder="Support"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>
                        <Field label="Reply Button Text" hint="Button label inside the popup (default: Reply)">
                            <Input
                                value={widgetConfig.popup_button_text || ''}
                                onChange={(e) => update({ popup_button_text: e.target.value })}
                                placeholder="Reply"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                            The popup color uses your primary/gradient color set in Colors below.
                        </p>
                    </Section>

                    {/* ── 4b. Notification Sounds ── */}
                    <Section icon={Volume2} title="Notification Sounds" description="Sound played when a new message arrives in the widget">
                        <Field label="Sound (collapsed widget)" hint="Plays when widget is minimised">
                            <div className="flex items-center gap-2">
                                <select
                                    value={widgetConfig.notification_sound_collapsed ?? 'notification.mp3'}
                                    onChange={(e) => update({ notification_sound_collapsed: e.target.value })}
                                    className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">--- (silent)</option>
                                    <option value="blackberry2.mp3">Blackberry 2</option>
                                    <option value="notification.mp3">Notification</option>
                                </select>
                                <button
                                    type="button"
                                    title="Preview sound"
                                    disabled={!widgetConfig.notification_sound_collapsed}
                                    onClick={() => { try { new Audio(`/sounds/${widgetConfig.notification_sound_collapsed}`).play() } catch { } }}
                                    className="flex-shrink-0 p-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Play className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </Field>
                        <Field label="Sound (open widget)" hint="Plays when widget is open (visitor may be in another tab)">
                            <div className="flex items-center gap-2">
                                <select
                                    value={widgetConfig.notification_sound_opened ?? 'notification.mp3'}
                                    onChange={(e) => update({ notification_sound_opened: e.target.value })}
                                    className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">--- (silent)</option>
                                    <option value="blackberry2.mp3">Blackberry 2</option>
                                    <option value="notification.mp3">Notification</option>
                                </select>
                                <button
                                    type="button"
                                    title="Preview sound"
                                    disabled={!widgetConfig.notification_sound_opened}
                                    onClick={() => { try { new Audio(`/sounds/${widgetConfig.notification_sound_opened}`).play() } catch { } }}
                                    className="flex-shrink-0 p-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Play className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </Field>
                    </Section>

                    {/* ── 5. Colors ── */}
                    <Section icon={Palette} title="Colors" description="Primary color applied to header, buttons, bubbles, and popup">
                        {/* Mode toggle */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">Color Mode</span>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                {(['gradient', 'solid'] as const).map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => update({ color_mode: m })}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${widgetConfig.color_mode === m
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                            }`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Preset swatches */}
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Presets</label>
                            <div className="flex flex-wrap gap-2">
                                {isGradient
                                    ? GRADIENT_PRESETS.map((p, i) => {
                                        const sel = widgetConfig.gradient_start === p.start && widgetConfig.gradient_end === p.end
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => update({ gradient_start: p.start, gradient_end: p.end, primary_color: p.start })}
                                                className={`w-8 h-8 rounded-full border-2 transition-all ${sel ? 'border-blue-500 scale-110 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-600 hover:scale-105'}`}
                                                style={{ background: `linear-gradient(135deg, ${p.start} 0%, ${p.end} 100%)` }}
                                                title={`${p.start} → ${p.end}`}
                                            />
                                        )
                                    })
                                    : SOLID_PRESETS.map((c, i) => {
                                        const sel = widgetConfig.primary_color === c
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => update({ primary_color: c })}
                                                className={`w-8 h-8 rounded-full border-2 transition-all ${sel ? 'border-blue-500 scale-110 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-600 hover:scale-105'}`}
                                                style={{ background: c }}
                                                title={c}
                                            />
                                        )
                                    })
                                }
                            </div>
                        </div>

                        {/* Custom color inputs */}
                        {isGradient ? (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Start Color</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={widgetConfig.gradient_start} onChange={(e) => update({ gradient_start: e.target.value, primary_color: e.target.value })} className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer" />
                                            <Input value={widgetConfig.gradient_start} onChange={(e) => update({ gradient_start: e.target.value, primary_color: e.target.value })} placeholder="#3b82f6" className="flex-1 text-xs font-mono dark:bg-gray-800 dark:border-gray-700" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">End Color</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={widgetConfig.gradient_end} onChange={(e) => update({ gradient_end: e.target.value })} className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer" />
                                            <Input value={widgetConfig.gradient_end} onChange={(e) => update({ gradient_end: e.target.value })} placeholder="#2563eb" className="flex-1 text-xs font-mono dark:bg-gray-800 dark:border-gray-700" />
                                        </div>
                                    </div>
                                </div>
                                <div className="h-8 rounded-xl w-full shadow-inner" style={{ background: `linear-gradient(135deg, ${widgetConfig.gradient_start} 0%, ${widgetConfig.gradient_end} 100%)` }} />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Custom Color</label>
                                <div className="flex items-center gap-2">
                                    <input type="color" value={widgetConfig.primary_color} onChange={(e) => update({ primary_color: e.target.value })} className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer" />
                                    <Input value={widgetConfig.primary_color} onChange={(e) => update({ primary_color: e.target.value })} placeholder="#3b82f6" className="flex-1 font-mono dark:bg-gray-800 dark:border-gray-700" />
                                </div>
                            </div>
                        )}
                    </Section>

                    {/* ── 6. Features ── */}
                    <Section icon={ToggleRight} title="Features" description="Toggle widget capabilities and visitor options">

                        <div className="flex items-center justify-between py-1">
                            <div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">File Attachments</span>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Let visitors attach files to messages</p>
                            </div>
                            <Switch checked={widgetConfig.show_attachments} onCheckedChange={(checked) => update({ show_attachments: checked })} />
                        </div>

                        <div className="border-t border-gray-100 dark:border-gray-700/50" />

                        <div className="flex items-center justify-between py-1">
                            <div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Emoji Picker</span>
                                <p className="text-xs text-amber-500 dark:text-amber-400 mt-0.5">Coming Soon</p>
                            </div>
                            <Switch checked={widgetConfig.show_emoji_picker} onCheckedChange={(checked) => update({ show_emoji_picker: checked })} disabled />
                        </div>

                        <div className="border-t border-gray-100 dark:border-gray-700/50" />

                        <div className="flex items-center justify-between py-1">
                            <div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Conversation History</span>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                    Returning visitors can view past conversations and start a new one
                                </p>
                            </div>
                            <Switch
                                checked={showConversationHistory}
                                onCheckedChange={onShowConversationHistoryChange}
                            />
                        </div>

                        <div className="border-t border-gray-100 dark:border-gray-700/50" />

                        <div className="pt-1">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">Branding Text</label>
                            <Input
                                value={widgetConfig.branding_text || ''}
                                onChange={(e) => update({ branding_text: e.target.value || null })}
                                placeholder="Powered by Your Company"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Optional footer text at the bottom of the widget</p>
                        </div>
                    </Section>
                </div>

                {/* ── Right: Live Previews (sticky) ── */}
                <div className="hidden xl:flex flex-col gap-5 sticky top-6">
                    <WidgetPreview config={widgetConfig} />
                    <PopupPreview config={widgetConfig} />
                </div>
            </div>
        </div>
    )
}
