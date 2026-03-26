import { useState, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { Image, Type, Palette, ToggleRight, Upload, MessageCircle, Sparkles } from 'lucide-react'
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
}

interface WebsiteWidgetTabProps {
    widgetConfig: WidgetConfig
    websiteId: number
    saving: boolean
    onConfigChange: (config: WidgetConfig) => void
    onUploadIcon: (file: File) => void
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

/* ── Live Preview ─────────────────────────────────────── */

function WidgetPreview({ config }: { config: WidgetConfig }) {
    const headerBg =
        config.color_mode === 'gradient'
            ? `linear-gradient(135deg, ${config.gradient_start || '#3b82f6'} 0%, ${config.gradient_end || '#2563eb'} 100%)`
            : config.primary_color || '#3b82f6'
    const bubbleBg = config.primary_color || '#3b82f6'
    const isDarkTheme = config.theme === 'dark'

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Live Preview</p>
            </div>
            <div className="p-5">
                <div className="relative mx-auto" style={{ width: 260 }}>
                    {/* Widget window */}
                    <div
                        className="rounded-2xl overflow-hidden shadow-xl border border-gray-200/60 dark:border-gray-600/40"
                        style={{ width: 260 }}
                    >
                        {/* Header */}
                        <div
                            className="px-4 py-3.5 flex items-center gap-3"
                            style={{ background: headerBg }}
                        >
                            {/* Icon */}
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {config.header_icon_url ? (
                                    <img
                                        src={`${API_BASE}${config.header_icon_url}`}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <MessageCircle className="w-4 h-4 text-white/80" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-white text-sm font-semibold truncate leading-tight">
                                    {config.header_title || 'How can we help?'}
                                </p>
                                <p className="text-white/70 text-[10px] truncate mt-0.5">
                                    {config.online_status_text || 'We reply immediately'}
                                </p>
                            </div>
                        </div>

                        {/* Body */}
                        <div
                            className={`px-4 py-5 space-y-3 ${isDarkTheme ? 'bg-gray-900' : 'bg-gray-50'}`}
                            style={{ minHeight: 80 }}
                        >
                            {/* Bot message */}
                            <div className="flex gap-2">
                                <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0 mt-0.5" />
                                <div
                                    className={`max-w-[75%] rounded-xl px-3 py-2 text-[10px] leading-relaxed ${isDarkTheme
                                        ? 'bg-gray-800 text-gray-200'
                                        : 'bg-white text-gray-700 shadow-sm'
                                        }`}
                                >
                                    Hi there! How can we help you today?
                                </div>
                            </div>
                            {/* User message */}
                            <div className="flex justify-end">
                                <div
                                    className="max-w-[75%] rounded-xl px-3 py-2 text-[10px] leading-relaxed text-white"
                                    style={{ background: bubbleBg }}
                                >
                                    I have a question
                                </div>
                            </div>
                        </div>

                        {/* Input bar */}
                        <div
                            className={`px-3 py-2.5 border-t flex items-center gap-2 ${isDarkTheme
                                ? 'bg-gray-900 border-gray-800'
                                : 'bg-white border-gray-100'
                                }`}
                        >
                            <div
                                className={`flex-1 h-7 rounded-lg ${isDarkTheme ? 'bg-gray-800' : 'bg-gray-100'}`}
                            />
                            <div
                                className="w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ background: bubbleBg }}
                            >
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                                </svg>
                            </div>
                        </div>

                        {/* Branding */}
                        {config.branding_text && (
                            <div
                                className={`text-center py-1.5 text-[8px] ${isDarkTheme
                                    ? 'bg-gray-900 text-gray-600'
                                    : 'bg-white text-gray-400'
                                    }`}
                            >
                                {config.branding_text}
                            </div>
                        )}
                    </div>

                    {/* Bubble */}
                    <div className="mt-3 flex justify-end">
                        <div
                            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-xs font-medium shadow-lg"
                            style={{ background: bubbleBg }}
                        >
                            <MessageCircle className="w-4 h-4" />
                            {config.bubble_text || 'Chat'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

/* ── Main component ───────────────────────────────────── */

export default function WebsiteWidgetTab({
    widgetConfig,
    websiteId,
    saving,
    onConfigChange,
    onUploadIcon,
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
            <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Widget Customization</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Configure how the chat widget looks and behaves on your site.
                </p>
            </div>

            {/* Two-column layout: config + preview */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
                {/* ── Left: Configuration ── */}
                <div className="space-y-5">
                    {/* ── Icon & Layout ── */}
                    <Section icon={Image} title="Icon & Layout" description="Brand identity and widget placement">
                        {/* Icon upload */}
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Header Icon</label>
                            <div className="flex items-start gap-4">
                                {/* Dropzone */}
                                {isAdmin(user) ? (
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`
                      relative w-20 h-20 rounded-xl border-2 border-dashed cursor-pointer
                      flex flex-col items-center justify-center gap-1 transition-all
                      ${dragOver
                                                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50 dark:bg-gray-900'
                                            }
                    `}
                                    >
                                        {widgetConfig.header_icon_url ? (
                                            <img
                                                src={`${API_BASE}${widgetConfig.header_icon_url}`}
                                                alt="Widget icon"
                                                className="w-full h-full object-cover rounded-[10px]"
                                            />
                                        ) : (
                                            <>
                                                <Upload className="w-4 h-4 text-gray-400" />
                                                <span className="text-[10px] text-gray-400">Upload</span>
                                            </>
                                        )}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0]
                                                if (file) onUploadIcon(file)
                                                e.currentTarget.value = ''
                                            }}
                                            className="hidden"
                                            disabled={saving}
                                        />
                                    </div>
                                ) : (
                                    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                                        {widgetConfig.header_icon_url ? (
                                            <img
                                                src={`${API_BASE}${widgetConfig.header_icon_url}`}
                                                alt="Widget icon"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-[10px] text-gray-400">None</span>
                                        )}
                                    </div>
                                )}
                                <div className="pt-1">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Drag & drop or click to upload.
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                        Shown in the header until an agent joins.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Theme + Position */}
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Theme">
                                <select
                                    value={widgetConfig.theme}
                                    onChange={(e) => update({ theme: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                >
                                    <option value="dark">Dark</option>
                                    <option value="light">Light</option>
                                </select>
                            </Field>
                            <Field label="Position">
                                <select
                                    value={widgetConfig.position}
                                    onChange={(e) => update({ position: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                >
                                    <option value="bottom-right">Bottom Right</option>
                                    <option value="bottom-left">Bottom Left</option>
                                    <option value="top-right">Top Right</option>
                                    <option value="top-left">Top Left</option>
                                </select>
                            </Field>
                        </div>
                    </Section>

                    {/* ── Text & Messaging ── */}
                    <Section icon={Type} title="Text & Messaging" description="Widget copy and status messages">
                        <Field label="Header Title" hint="Text shown in the widget header">
                            <Input
                                value={widgetConfig.header_title}
                                onChange={(e) => update({ header_title: e.target.value })}
                                placeholder="How can we help?"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>

                        <Field label="Online Status Text" hint="Status message shown below header">
                            <Input
                                value={widgetConfig.online_status_text}
                                onChange={(e) => update({ online_status_text: e.target.value })}
                                placeholder="We reply immediately"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>

                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">Welcome automation is managed in the Automations tab.</p>

                        <Field label="Bubble Text" hint="Text shown on the minimized chat bubble">
                            <Input
                                value={widgetConfig.bubble_text}
                                onChange={(e) => update({ bubble_text: e.target.value })}
                                placeholder="Chat"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>

                        <Field label="Popup Name" hint="Sender name shown in the notification popup (default: Support)">
                            <Input
                                value={widgetConfig.popup_name || ''}
                                onChange={(e) => update({ popup_name: e.target.value })}
                                placeholder="Support"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>

                        <Field label="Popup Button Text" hint="Button text in the notification popup (default: Reply)">
                            <Input
                                value={widgetConfig.popup_button_text || ''}
                                onChange={(e) => update({ popup_button_text: e.target.value })}
                                placeholder="Reply"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>

                        <Field label="Branding Text" hint="Optional branding text shown at bottom of widget">
                            <Input
                                value={widgetConfig.branding_text || ''}
                                onChange={(e) => update({ branding_text: e.target.value || null })}
                                placeholder="Powered by Your Company"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </Field>
                    </Section>

                    {/* ── Colors ── */}
                    <Section icon={Palette} title="Colors" description="Primary color for header, buttons, and bubbles">
                        {/* Mode toggle */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">Color Mode</span>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                <button
                                    type="button"
                                    onClick={() => update({ color_mode: 'gradient' })}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isGradient
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                        }`}
                                >
                                    Gradient
                                </button>
                                <button
                                    type="button"
                                    onClick={() => update({ color_mode: 'solid' })}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!isGradient
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                        }`}
                                >
                                    Solid
                                </button>
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
                                            <input
                                                type="color"
                                                value={widgetConfig.gradient_start}
                                                onChange={(e) => update({ gradient_start: e.target.value, primary_color: e.target.value })}
                                                className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                                            />
                                            <Input
                                                value={widgetConfig.gradient_start}
                                                onChange={(e) => update({ gradient_start: e.target.value, primary_color: e.target.value })}
                                                placeholder="#3b82f6"
                                                className="flex-1 text-xs font-mono dark:bg-gray-800 dark:border-gray-700"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">End Color</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={widgetConfig.gradient_end}
                                                onChange={(e) => update({ gradient_end: e.target.value })}
                                                className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                                            />
                                            <Input
                                                value={widgetConfig.gradient_end}
                                                onChange={(e) => update({ gradient_end: e.target.value })}
                                                placeholder="#2563eb"
                                                className="flex-1 text-xs font-mono dark:bg-gray-800 dark:border-gray-700"
                                            />
                                        </div>
                                    </div>
                                </div>
                                {/* Gradient preview bar */}
                                <div
                                    className="h-8 rounded-xl w-full shadow-inner"
                                    style={{ background: `linear-gradient(135deg, ${widgetConfig.gradient_start} 0%, ${widgetConfig.gradient_end} 100%)` }}
                                />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Custom Color</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={widgetConfig.primary_color}
                                        onChange={(e) => update({ primary_color: e.target.value })}
                                        className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
                                    />
                                    <Input
                                        value={widgetConfig.primary_color}
                                        onChange={(e) => update({ primary_color: e.target.value })}
                                        placeholder="#3b82f6"
                                        className="flex-1 font-mono dark:bg-gray-800 dark:border-gray-700"
                                    />
                                </div>
                            </div>
                        )}
                    </Section>

                    {/* ── Features ── */}
                    <Section icon={ToggleRight} title="Features" description="Toggle widget capabilities">
                        <div className="flex items-center justify-between py-1">
                            <div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">File Attachments</span>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Let visitors attach files to messages</p>
                            </div>
                            <Switch
                                checked={widgetConfig.show_attachments}
                                onCheckedChange={(checked) => update({ show_attachments: checked })}
                            />
                        </div>
                        <div className="border-t border-gray-100 dark:border-gray-700/50" />
                        <div className="flex items-center justify-between py-1">
                            <div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Emoji Picker</span>
                                <p className="text-xs text-amber-500 dark:text-amber-400 mt-0.5">Coming Soon</p>
                            </div>
                            <Switch
                                checked={widgetConfig.show_emoji_picker}
                                onCheckedChange={(checked) => update({ show_emoji_picker: checked })}
                                disabled
                            />
                        </div>
                    </Section>
                </div>

                {/* ── Right: Live Preview (sticky) ── */}
                <div className="hidden xl:block sticky top-6">
                    <WidgetPreview config={widgetConfig} />
                </div>
            </div>
        </div>
    )
}
