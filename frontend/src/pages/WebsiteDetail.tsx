import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/appStore'
import { isAdmin, isAdministrator } from '@/lib/roles'
import { Save, Trash2, Globe, Copy, Check, Plus, X, Code, ExternalLink, AlertTriangle } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'
import { automationsApi, automationTemplatesApi, type Automation, type AutomationTemplate } from '@/services/automations'
import AutomationFlowCanvas from '@/components/AutomationFlowCanvas'
import WebsiteShortcutsTab from './WebsiteShortcutsTab'
import WebsiteTagsTab from './WebsiteTagsTab'
import WebsiteTeamsTab from './WebsiteTeamsTab'
import WebsiteFormsTab from './WebsiteFormsTab'
import WebsiteWidgetTab from './WebsiteWidgetTab'

interface Website {
  id: number
  name: string
  domain: string
  widget_key?: string
  show_conversation_history: boolean
  widget_config: {
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
    office_hours?: any
  } | null
  created_at: string
}

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type OfficeHoursInterval = {
  start: string
  end: string
}

type OfficeHoursSchedule = Record<DayKey, OfficeHoursInterval[]>

type OfficeHoursConfig = {
  enabled: boolean
  timezone: string
  schedule: OfficeHoursSchedule
}

const DEFAULT_OFFICE_HOURS_SCHEDULE: OfficeHoursSchedule = {
  mon: [{ start: '08:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '17:00' }],
  sat: [],
  sun: [],
}

const getBrowserTimeZone = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    // Some environments return deprecated aliases not present in server tzdata.
    if (tz === 'Asia/Calcutta') return 'Asia/Kolkata'
    return tz
  } catch {
    return 'UTC'
  }
}

const coerceOfficeHours = (raw: any): OfficeHoursConfig => {
  const base: OfficeHoursConfig = {
    enabled: false,
    timezone: getBrowserTimeZone(),
    schedule: { ...DEFAULT_OFFICE_HOURS_SCHEDULE },
  }

  if (!raw || typeof raw !== 'object') return base

  const schedule: any = (raw as any).schedule
  const nextSchedule: OfficeHoursSchedule = { ...DEFAULT_OFFICE_HOURS_SCHEDULE }
    ; (Object.keys(nextSchedule) as DayKey[]).forEach((k) => {
      const v = schedule?.[k]
      nextSchedule[k] = Array.isArray(v)
        ? v
          .filter((i: any) => i && typeof i === 'object')
          .map((i: any) => ({ start: String(i.start || '').slice(0, 5), end: String(i.end || '').slice(0, 5) }))
          .filter((i: any) => i.start && i.end)
        : nextSchedule[k]
    })

  return {
    enabled: (raw as any).enabled === true,
    timezone: String((raw as any).timezone || '').trim() || base.timezone,
    schedule: nextSchedule,
  }
}

type TabType = 'installation' | 'settings' | 'widget' | 'automations' | 'teams' | 'shortcuts' | 'tags' | 'forms' | 'danger'

export default function WebsiteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAppStore()
  const isNew = id === 'new'
  const websiteId = id && id !== 'new' ? parseInt(id) : null
  const [searchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as TabType) || 'installation'
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [widgetKeyCopied, setWidgetKeyCopied] = useState(false)
  const [widgetSnippet, setWidgetSnippet] = useState('')
  const [widgetKey, setWidgetKey] = useState<string | null>(null)
  const [automations, setAutomations] = useState<Automation[]>([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const [automationsError, setAutomationsError] = useState<string | null>(null)
  const [savingAutomationId, setSavingAutomationId] = useState<number | null>(null)
  const [deletingAutomationId, setDeletingAutomationId] = useState<number | null>(null)
  const [automationsSubTab, setAutomationsSubTab] = useState<'library' | 'messages' | 'chatbots' | 'ai_agents'>('library')
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasAutomation, setCanvasAutomation] = useState<Automation | null>(null)
  const [templates, setTemplates] = useState<AutomationTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [usingTemplateId, setUsingTemplateId] = useState<number | null>(null)

  // Deletion modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletionImpact, setDeletionImpact] = useState<{
    conversations: number
    messages: number
    automations: number
    teams: number
    tags: number
    shortcuts: number
  } | null>(null)
  const [deletionImpactLoading, setDeletionImpactLoading] = useState(false)

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    show_conversation_history: false,
    widget_config: {
      theme: 'dark',
      position: 'bottom-right',
      welcome_message: 'Hi! How can we help you today?',
      primary_color: '#3b82f6',
      color_mode: 'gradient' as 'solid' | 'gradient',
      gradient_start: '#3b82f6',
      gradient_end: '#2563eb',
      header_title: 'How can we help?',
      online_status_text: 'We reply immediately',
      bubble_text: 'Chat',
      show_emoji_picker: true,
      show_attachments: false,
      branding_text: null as string | null,
      header_icon_url: null as string | null,
      popup_name: '',
      popup_button_text: '',
      notification_sound_collapsed: 'notification.mp3',
      notification_sound_opened: 'notification.mp3',
      office_hours: coerceOfficeHours(null),
    }
  })

  useEffect(() => {
    if (!isNew && id) {
      loadWebsite()
      loadSnippet()
    }
  }, [id, isNew])

  useEffect(() => {
    if (!websiteId) return
    if (activeTab !== 'automations') return
    loadAutomations()
    loadTemplates()
  }, [activeTab, websiteId])

  const loadTemplates = async () => {
    try {
      setTemplatesLoading(true)
      const data = await automationTemplatesApi.list()
      setTemplates(Array.isArray(data) ? data : [])
    } catch {
      // non-fatal — library just won't show
    } finally {
      setTemplatesLoading(false)
    }
  }

  const loadAutomations = async () => {
    if (!websiteId) return
    try {
      setAutomationsLoading(true)
      setAutomationsError(null)
      const data = await automationsApi.list(websiteId)
      setAutomations(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to load automations')
    } finally {
      setAutomationsLoading(false)
    }
  }

  const updateAutomationLocal = (id: number, updates: Partial<Automation>) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)))
  }

  const saveAutomation = async (automation: Automation) => {
    try {
      setSavingAutomationId(automation.id)
      await automationsApi.update(automation.id, { enabled: automation.enabled })
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to save automation')
    } finally {
      setSavingAutomationId(null)
    }
  }

  const deleteAutomation = async (automation: Automation) => {
    if (!confirm(`Delete automation "${automation.name}"? This cannot be undone.`)) return
    try {
      setDeletingAutomationId(automation.id)
      await automationsApi.remove(automation.id)
      setAutomations((prev) => prev.filter((a) => a.id !== automation.id))
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to delete automation')
    } finally {
      setDeletingAutomationId(null)
    }
  }

  const loadSnippet = async () => {
    if (!id) return
    try {
      const data = await apiRequest<{ snippet: string }>(`/widget/snippet/${id}`)
      setWidgetSnippet(data.snippet)
    } catch (err: any) {
      console.error('Failed to load snippet:', err)
    }
  }

  const loadWebsite = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<Website>(`/websites/${id}`)
      setWidgetKey(data.widget_key || null)
      const defaultWelcome = data.widget_config?.welcome_message || 'Hi! How can we help you today?'
      const officeHours = coerceOfficeHours((data.widget_config as any)?.office_hours)
      setFormData({
        name: data.name,
        domain: data.domain,
        show_conversation_history: data.show_conversation_history ?? false,
        widget_config: {
          theme: data.widget_config?.theme || 'dark',
          position: data.widget_config?.position || 'bottom-right',
          welcome_message: defaultWelcome,
          primary_color: data.widget_config?.primary_color || '#3b82f6',
          color_mode: (data.widget_config as any)?.color_mode === 'solid' ? 'solid' : 'gradient',
          gradient_start: (data.widget_config as any)?.gradient_start || '#3b82f6',
          gradient_end: (data.widget_config as any)?.gradient_end || '#2563eb',
          header_title: data.widget_config?.header_title || 'How can we help?',
          online_status_text: data.widget_config?.online_status_text || 'We reply immediately',
          bubble_text: data.widget_config?.bubble_text || 'Chat',
          show_emoji_picker: data.widget_config?.show_emoji_picker !== undefined ? data.widget_config.show_emoji_picker : true,
          show_attachments: data.widget_config?.show_attachments || false,
          branding_text: data.widget_config?.branding_text ?? null,
          header_icon_url: data.widget_config?.header_icon_url ?? null,
          popup_name: (data.widget_config as any)?.popup_name || '',
          popup_button_text: (data.widget_config as any)?.popup_button_text || '',
          notification_sound_collapsed: (data.widget_config as any)?.notification_sound_collapsed ?? 'notification.mp3',
          notification_sound_opened: (data.widget_config as any)?.notification_sound_opened ?? 'notification.mp3',
          office_hours: officeHours,
        }
      })
    } catch (err: any) {
      setError(err.message || 'Failed to load website')
    } finally {
      setLoading(false)
    }
  }


  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      if (isNew) {
        await apiRequest('/websites', {
          method: 'POST',
          body: JSON.stringify(formData),
        })
        setSuccessMessage('Website created successfully')
        setTimeout(() => navigate('/dashboard/settings/websites'), 1500)
      } else {
        await apiRequest(`/websites/${id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        })
        setSuccessMessage('Website updated successfully')
        await loadWebsite()
        await loadSnippet()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save website')
    } finally {
      setSaving(false)
    }
  }

  const copySnippet = () => {
    navigator.clipboard.writeText(widgetSnippet)
    setSnippetCopied(true)
    setTimeout(() => setSnippetCopied(false), 2000)
  }

  const copyWidgetKey = () => {
    if (!widgetKey) return
    navigator.clipboard.writeText(widgetKey)
    setWidgetKeyCopied(true)
    setTimeout(() => setWidgetKeyCopied(false), 2000)
  }

  const handleDelete = async () => {
    try {
      setSaving(true)
      await apiRequest(`/websites/${id}`, {
        method: 'DELETE',
      })
      setDeleteModalOpen(false)
      navigate('/dashboard/settings/websites')
    } catch (err: any) {
      setError(err.message || 'Failed to delete website')
      setSaving(false)
    }
  }

  const openDeleteModal = async () => {
    setDeleteConfirmText('')
    setDeleteModalOpen(true)
    setDeletionImpact(null)
    setDeletionImpactLoading(true)
    try {
      const data = await apiRequest<{
        conversations: number
        messages: number
        automations: number
        teams: number
        tags: number
        shortcuts: number
      }>(`/websites/${id}/deletion-impact`)
      setDeletionImpact(data)
    } catch {
      // Non-fatal — modal still works without counts
    } finally {
      setDeletionImpactLoading(false)
    }
  }

  const handleUploadWidgetIcon = async (file: File) => {
    if (!websiteId) return
    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)

      const token = localStorage.getItem('auth_token')
      const form = new FormData()
      form.append('file', file)

      const res = await fetch(`${API_BASE}/websites/${websiteId}/widget-icon/upload`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to upload icon')
      }

      const data = await res.json()
      setFormData((prev) => ({
        ...prev,
        widget_config: {
          ...prev.widget_config,
          header_icon_url: data.header_icon_url ?? prev.widget_config.header_icon_url,
        },
      }))
      setSuccessMessage('Widget icon uploaded successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to upload icon')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading website...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-16 flex items-center gap-3 border-b dark:border-gray-700 px-6 flex-shrink-0">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
          {formData.widget_config.header_icon_url ? (
            <img
              src={`${API_BASE}${formData.widget_config.header_icon_url}`}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <Globe className="h-3.5 w-3.5 text-white" />
          )}
        </div>
        <div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
            {formData.name || 'Website'}
          </h1>
          {formData.domain && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{formData.domain}</p>
          )}
        </div>
      </div>

      {/* Full-height tabs with slide-over panels (rendered outside scroll wrapper) */}
      {!isNew && activeTab === 'shortcuts' && isAdmin(user) && websiteId && (
        <WebsiteShortcutsTab websiteId={websiteId} />
      )}
      {!isNew && activeTab === 'tags' && isAdmin(user) && websiteId && (
        <WebsiteTagsTab websiteId={websiteId} />
      )}
      {!isNew && activeTab === 'teams' && isAdmin(user) && websiteId && (
        <WebsiteTeamsTab websiteId={websiteId} />
      )}
      {!isNew && activeTab === 'forms' && isAdmin(user) && websiteId && (
        <WebsiteFormsTab websiteId={websiteId} />
      )}

      {/* Scrollable content (hidden when full-height tabs are active) */}
      {activeTab !== 'shortcuts' && activeTab !== 'tags' && activeTab !== 'teams' && activeTab !== 'forms' && (
        <div className="flex-1 overflow-auto relative">
          <div className="px-6 py-6 space-y-6">
            {error && (
              <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="p-3 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                {successMessage}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
              {/* Installation Tab */}
              {!isNew && activeTab === 'installation' && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">Installation</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Add the chat widget to your website in minutes.</p>
                  </div>

                  {/* Quick-start steps */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {[
                      { step: '1', label: 'Copy snippet', desc: 'Copy the embed code below' },
                      { step: '2', label: 'Paste in HTML', desc: 'Before closing </body> tag' },
                      { step: '3', label: 'Assign agents', desc: 'In the Teams tab' },
                      { step: '4', label: 'Go live', desc: 'Widget appears automatically' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-start gap-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-3 py-2.5">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[10px] font-bold text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">{s.step}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{s.label}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Credentials row */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-3.5 py-2.5">
                      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Website ID</p>
                      <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-100">{websiteId ?? '—'}</p>
                    </div>
                    <div className="sm:col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-3.5 py-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Widget Key</p>
                        <button
                          type="button"
                          onClick={copyWidgetKey}
                          disabled={!widgetKey}
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-40 inline-flex items-center gap-1"
                        >
                          {widgetKeyCopied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                        </button>
                      </div>
                      <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-100 break-all leading-snug">{widgetKey || '—'}</p>
                    </div>
                  </div>

                  {/* Embed snippet */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2">
                        <Code className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Embed Snippet</span>
                      </div>
                      <Button type="button" onClick={copySnippet} variant="outline" size="sm" className="h-6 gap-1.5 text-[11px] px-2">
                        {snippetCopied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                      </Button>
                    </div>
                    <div className="bg-gray-900 dark:bg-gray-950 p-4 overflow-x-auto">
                      <pre className="text-[13px] leading-relaxed text-gray-300 font-mono whitespace-pre-wrap">
                        {widgetSnippet || 'Loading...'}
                      </pre>
                    </div>
                  </div>

                  {/* Domain hint */}
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span>Widget will only load on <span className="font-medium text-gray-700 dark:text-gray-300">{formData.domain || 'your configured domain'}</span>. Change it in the General tab.</span>
                  </div>
                </div>
              )}

              {/* Automations Tab */}
              {!isNew && activeTab === 'automations' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Automations</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Configure per-website automation flows.</p>
                    </div>
                    <Button type="button" size="sm" onClick={() => { setCanvasAutomation(null); setCanvasOpen(true) }} className="gap-2">
                      <Plus className="w-4 h-4" />
                      New flow
                    </Button>
                  </div>

                  {/* Sub-tab pills */}
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
                    {(['library', 'messages', 'chatbots', 'ai_agents'] as const).map((tab) => {
                      const labels: Record<string, string> = { library: 'Library', messages: 'Messages', chatbots: 'Chatbots', ai_agents: 'AI Agents' }
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setAutomationsSubTab(tab)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${automationsSubTab === tab
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                          {labels[tab]}
                        </button>
                      )
                    })}
                  </div>

                  {automationsError && (
                    <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                      {automationsError}
                    </div>
                  )}

                  {automationsSubTab === 'library' ? (
                    templatesLoading ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400">Loading templates…</div>
                    ) : templates.length === 0 ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400">No templates available.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {templates.map((tpl) => {
                          const existing = automations.find((a) => a.template_id === tpl.id) ?? null
                          return (
                            <div
                              key={tpl.id}
                              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tpl.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Trigger: {tpl.trigger}</div>
                                  {tpl.description && (
                                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{tpl.description}</div>
                                  )}
                                </div>
                                <div className="shrink-0 flex items-center gap-2">
                                  {existing ? (
                                    <>
                                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${existing.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                                        {existing.enabled ? 'Active' : 'Disabled'}
                                      </span>
                                      <Button
                                        type="button" size="sm" variant="outline"
                                        onClick={() => { setCanvasAutomation(existing); setCanvasOpen(true) }}
                                      >
                                        Edit
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      type="button" size="sm"
                                      disabled={usingTemplateId === tpl.id}
                                      onClick={async () => {
                                        if (!websiteId) return
                                        try {
                                          setUsingTemplateId(tpl.id)
                                          setAutomationsError(null)
                                          const created = await automationTemplatesApi.use(tpl.id, websiteId)
                                          await loadAutomations()
                                          setCanvasAutomation(created)
                                          setCanvasOpen(true)
                                        } catch (err: any) {
                                          setAutomationsError(err?.message || 'Failed to use template')
                                        } finally {
                                          setUsingTemplateId(null)
                                        }
                                      }}
                                    >
                                      {usingTemplateId === tpl.id ? 'Adding…' : 'Use template'}
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
                                <span>{(tpl.nodes?.length ?? 0)} nodes</span>
                                <span>·</span>
                                <span>{tpl.category}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  ) : automationsLoading ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">Loading automations…</div>
                  ) : automationsSubTab === 'messages' ? (
                    (() => {
                      const items = automations.filter((a) => a.category !== 'chatbot_flow' && a.category !== 'ai_agent')
                      if (items.length === 0) {
                        return <div className="text-sm text-gray-500 dark:text-gray-400">No message automations yet. Use a Library template or click "New flow".</div>
                      }
                      return (
                        <div className="space-y-2">
                          {items.map((automation) => (
                            <div key={automation.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4">
                              <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{automation.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{automation.trigger}</div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Switch
                                    checked={automation.enabled}
                                    onCheckedChange={(checked) => {
                                      updateAutomationLocal(automation.id, { enabled: checked })
                                      saveAutomation({ ...automation, enabled: checked })
                                    }}
                                  />
                                  <Button type="button" size="sm" variant="outline" onClick={() => { setCanvasAutomation(automation); setCanvasOpen(true) }}>
                                    Edit
                                  </Button>
                                  <Button
                                    type="button" size="sm" variant="destructive"
                                    onClick={() => deleteAutomation(automation)}
                                    disabled={deletingAutomationId === automation.id}
                                    className="gap-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    {deletingAutomationId === automation.id ? 'Deleting…' : 'Delete'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()
                  ) : automationsSubTab === 'chatbots' ? (
                    (() => {
                      const items = automations.filter((a) => a.category === 'chatbot_flow')
                      if (items.length === 0) {
                        return <div className="text-sm text-gray-500 dark:text-gray-400">No chatbot flows yet. Click "New flow" to create one.</div>
                      }
                      return (
                        <div className="space-y-2">
                          {items.map((automation) => (
                            <div key={automation.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4">
                              <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{automation.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{automation.trigger}</div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Switch
                                    checked={automation.enabled}
                                    onCheckedChange={(checked) => {
                                      updateAutomationLocal(automation.id, { enabled: checked })
                                      saveAutomation({ ...automation, enabled: checked })
                                    }}
                                  />
                                  <Button type="button" size="sm" variant="outline" onClick={() => { setCanvasAutomation(automation); setCanvasOpen(true) }}>
                                    Edit
                                  </Button>
                                  <Button
                                    type="button" size="sm" variant="destructive"
                                    onClick={() => deleteAutomation(automation)}
                                    disabled={deletingAutomationId === automation.id}
                                    className="gap-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    {deletingAutomationId === automation.id ? 'Deleting…' : 'Delete'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center space-y-2">
                      <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">AI Agents</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                        Coming soon — AI-powered agents that handle conversations autonomously.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Basic Settings Tab */}
              {(isNew || activeTab === 'settings') && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">General</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Website identification and domain settings.</p>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Website Name *</label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="My Website"
                        required
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A friendly name to identify this website</p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Domain *</label>
                      <Input
                        value={formData.domain}
                        onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                        placeholder="example.com"
                        required
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The domain where the chat widget will be embedded</p>
                    </div>
                  </div>
                </div>
              )}



              {/* Office Hours */}
              {(isNew || activeTab === 'settings') && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Office Hours</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">When enabled, the widget is forced offline outside these hours.</p>
                    </div>
                    <Switch
                      checked={!!(formData.widget_config as any).office_hours?.enabled}
                      onCheckedChange={(checked) => {
                        const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                        setFormData({
                          ...formData,
                          widget_config: {
                            ...formData.widget_config,
                            office_hours: { ...current, enabled: checked },
                          },
                        })
                      }}
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Timezone</label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={String((formData.widget_config as any).office_hours?.timezone || '')}
                          onChange={(e) => {
                            const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                            setFormData({
                              ...formData,
                              widget_config: {
                                ...formData.widget_config,
                                office_hours: { ...current, timezone: e.target.value },
                              },
                            })
                          }}
                          placeholder="e.g. Europe/London"
                          className="dark:bg-gray-800 dark:border-gray-700"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                            setFormData({
                              ...formData,
                              widget_config: {
                                ...formData.widget_config,
                                office_hours: { ...current, timezone: getBrowserTimeZone() },
                              },
                            })
                          }}
                        >
                          Use browser
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Uses IANA timezone names (must match your account timezone).</p>
                    </div>

                    <div className="space-y-2">
                      {(
                        [
                          { key: 'mon', label: 'Monday' },
                          { key: 'tue', label: 'Tuesday' },
                          { key: 'wed', label: 'Wednesday' },
                          { key: 'thu', label: 'Thursday' },
                          { key: 'fri', label: 'Friday' },
                          { key: 'sat', label: 'Saturday' },
                          { key: 'sun', label: 'Sunday' },
                        ] as { key: DayKey; label: string }[]
                      ).map((day) => {
                        const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                        const intervals = current.schedule[day.key] || []
                        const dayEnabled = intervals.length > 0
                        const disabled = !current.enabled

                        return (
                          <div key={day.key} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                            {/* Day label + toggle — inline on mobile, acts as two flex items on sm+ */}
                            <div className="flex items-center gap-3 sm:contents">
                              <div className="w-24 shrink-0 sm:pt-1">
                                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{day.label}</span>
                              </div>
                              <Switch
                                checked={dayEnabled}
                                disabled={disabled}
                                onCheckedChange={(checked) => {
                                  const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                  const nextSchedule = { ...next.schedule }
                                  nextSchedule[day.key] = checked ? [{ start: '08:00', end: '17:00' }] : []
                                  setFormData({
                                    ...formData,
                                    widget_config: {
                                      ...formData.widget_config,
                                      office_hours: { ...next, schedule: nextSchedule },
                                    },
                                  })
                                }}
                              />
                            </div>
                            <div className="flex-1 pl-1 sm:pl-0">
                              {dayEnabled ? (
                                <div className="space-y-2">
                                  {intervals.map((interval, idx) => (
                                    <div key={idx} className="flex items-center gap-2 flex-wrap">
                                      <input
                                        type="time"
                                        value={interval.start}
                                        disabled={disabled}
                                        onChange={(e) => {
                                          const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                          const nextSchedule = { ...next.schedule }
                                          const nextIntervals = [...(nextSchedule[day.key] || [])]
                                          nextIntervals[idx] = { ...nextIntervals[idx], start: e.target.value }
                                          nextSchedule[day.key] = nextIntervals
                                          setFormData({
                                            ...formData,
                                            widget_config: {
                                              ...formData.widget_config,
                                              office_hours: { ...next, schedule: nextSchedule },
                                            },
                                          })
                                        }}
                                        className="w-32 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                      />
                                      <span className="text-xs text-gray-400">–</span>
                                      <input
                                        type="time"
                                        value={interval.end}
                                        disabled={disabled}
                                        onChange={(e) => {
                                          const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                          const nextSchedule = { ...next.schedule }
                                          const nextIntervals = [...(nextSchedule[day.key] || [])]
                                          nextIntervals[idx] = { ...nextIntervals[idx], end: e.target.value }
                                          nextSchedule[day.key] = nextIntervals
                                          setFormData({
                                            ...formData,
                                            widget_config: {
                                              ...formData.widget_config,
                                              office_hours: { ...next, schedule: nextSchedule },
                                            },
                                          })
                                        }}
                                        className="w-32 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                      />
                                      <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => {
                                          const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                          const nextSchedule = { ...next.schedule }
                                          const nextIntervals = [...(nextSchedule[day.key] || [])]
                                          nextIntervals.splice(idx, 1)
                                          nextSchedule[day.key] = nextIntervals
                                          setFormData({
                                            ...formData,
                                            widget_config: {
                                              ...formData.widget_config,
                                              office_hours: { ...next, schedule: nextSchedule },
                                            },
                                          })
                                        }}
                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                      const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                      const nextSchedule = { ...next.schedule }
                                      const nextIntervals = [...(nextSchedule[day.key] || [])]
                                      nextIntervals.push({ start: '08:00', end: '17:00' })
                                      nextSchedule[day.key] = nextIntervals
                                      setFormData({
                                        ...formData,
                                        widget_config: {
                                          ...formData.widget_config,
                                          office_hours: { ...next, schedule: nextSchedule },
                                        },
                                      })
                                    }}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Add interval
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400 pt-1 inline-block">Closed</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Widget Configuration Tab */}
              {!isNew && activeTab === 'widget' && (
                <WebsiteWidgetTab
                  widgetConfig={formData.widget_config}
                  websiteId={Number(websiteId)}
                  saving={saving}
                  showConversationHistory={formData.show_conversation_history}
                  onConfigChange={(config) => setFormData({ ...formData, widget_config: { ...formData.widget_config, ...config } })}
                  onUploadIcon={handleUploadWidgetIcon}
                  onShowConversationHistoryChange={(checked) => setFormData({ ...formData, show_conversation_history: checked })}
                />
              )}

              {/* Danger Zone Tab */}
              {!isNew && activeTab === 'danger' && isAdministrator(user) && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Irreversible actions for this website.</p>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Delete this website</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Permanently removes the website and all associated data.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={openDeleteModal}
                      disabled={saving}
                      className="gap-1 shrink-0 ml-4"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </Button>
                  </div>

                  {/* Delete Confirmation Modal */}
                  {deleteModalOpen && (
                    <>
                      <div
                        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 !mt-0"
                        onClick={() => setDeleteModalOpen(false)}
                      />
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 !mt-0">
                        <div
                          className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Modal header */}
                          <div className="px-6 pt-6 pb-4 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                Delete &ldquo;{formData.name}&rdquo;?
                              </h3>
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                This action is permanent and cannot be undone.
                              </p>
                            </div>
                          </div>

                          {/* Impact counts */}
                          <div className="px-6 pb-4">
                            {deletionImpactLoading ? (
                              <div className="text-sm text-gray-400 dark:text-gray-500 py-3">Loading impact data…</div>
                            ) : deletionImpact ? (
                              <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-900/10 p-4">
                                <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-3 uppercase tracking-wider">The following will be permanently deleted</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                  {[
                                    { label: 'Conversations', count: deletionImpact.conversations },
                                    { label: 'Messages', count: deletionImpact.messages },
                                    { label: 'Automations', count: deletionImpact.automations },
                                    { label: 'Teams', count: deletionImpact.teams },
                                    { label: 'Tags', count: deletionImpact.tags },
                                    { label: 'Shortcuts', count: deletionImpact.shortcuts },
                                  ].map(({ label, count }) => (
                                    <div key={label} className="flex items-center justify-between">
                                      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
                                      <span className={`text-sm font-semibold ${count > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-600'}`}>
                                        {count.toLocaleString()}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* Confirm input */}
                          <div className="px-6 pb-4">
                            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
                              Type <span className="font-semibold text-red-600 dark:text-red-400">{formData.name}</span> to confirm
                            </label>
                            <Input
                              value={deleteConfirmText}
                              onChange={(e) => setDeleteConfirmText(e.target.value)}
                              placeholder={formData.name}
                              className="dark:bg-gray-800 dark:border-gray-700"
                              autoFocus
                            />
                          </div>

                          {/* Modal footer */}
                          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteModalOpen(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={deleteConfirmText !== formData.name || saving}
                              onClick={handleDelete}
                              className="gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {saving ? 'Deleting…' : 'Delete Website'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Save / Cancel buttons (shown on tabs that have form data) */}
              {(isNew || activeTab === 'settings' || activeTab === 'widget') && (
                <div className="flex items-center gap-3 pt-2">
                  <Button type="submit" size="sm" disabled={saving} className="gap-2">
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : isNew ? 'Create Website' : 'Save Changes'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/dashboard/settings/websites')}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </form>
          </div>

          {canvasOpen && websiteId && (
            <AutomationFlowCanvas
              websiteId={websiteId}
              automation={canvasAutomation}
              onClose={() => setCanvasOpen(false)}
              onSaved={async () => { setCanvasOpen(false); await loadAutomations() }}
            />
          )}
        </div>
      )}
    </div>
  )
}
