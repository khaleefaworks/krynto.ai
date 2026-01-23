import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { ArrowLeft, Save, Trash2, Globe, Code, Settings, Palette, Copy, Check, Bot } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'
import { automationsApi, type Automation, type AutomationAction } from '@/services/automations'

interface Website {
  id: number
  name: string
  domain: string
  widget_key?: string
  widget_config: {
    theme?: string
    position?: string
    welcome_message?: string
    automations?: {
      welcome_enabled?: boolean
      welcome_message?: string
      welcome_cooldown_hours?: number
    }
    primary_color?: string
    header_title?: string
    online_status_text?: string
    bubble_text?: string
    show_emoji_picker?: boolean
    show_attachments?: boolean
    branding_text?: string | null
    header_icon_url?: string | null
  } | null
  created_at: string
}

type TabType = 'installation' | 'settings' | 'widget' | 'automations'

export default function WebsiteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAppStore()
  const isNew = id === 'new'
  const websiteId = id && id !== 'new' ? parseInt(id) : null
  const [activeTab, setActiveTab] = useState<TabType>('installation')
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

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    widget_config: {
      theme: 'dark',
      position: 'bottom-right',
      welcome_message: 'Hi! How can we help you today?',
      automations: {
        welcome_enabled: true,
        welcome_message: 'Hi! How can we help you today?',
        welcome_cooldown_hours: 24,
      },
      primary_color: '#000000',
      header_title: 'How can we help?',
      online_status_text: 'We reply immediately',
      bubble_text: 'Chat',
      show_emoji_picker: true,
      show_attachments: false,
      branding_text: null as string | null,
      header_icon_url: null as string | null,
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
  }, [activeTab, websiteId])

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

  const extractPrimaryAction = (automation: Automation): AutomationAction | null => {
    const actions = automation.actions
    if (Array.isArray(actions)) {
      return (actions.find((a) => a?.type === 'send_bot_message') || null) as AutomationAction | null
    }
    if (actions && typeof actions === 'object' && (actions as any).type === 'send_bot_message') {
      return actions as AutomationAction
    }
    return null
  }

  const updateAutomationAction = (automation: Automation, nextAction: AutomationAction) => {
    const actions = automation.actions
    if (Array.isArray(actions)) {
      const next = actions.map((a) => (a?.type === 'send_bot_message' ? nextAction : a))
      return next
    }
    return nextAction
  }

  const saveAutomation = async (automation: Automation) => {
    try {
      setSavingAutomationId(automation.id)
      await automationsApi.update(automation.id, {
        name: automation.name,
        trigger: automation.trigger,
        enabled: automation.enabled,
        conditions: automation.conditions || {},
        actions: automation.actions || {},
      })
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to save automation')
    } finally {
      setSavingAutomationId(null)
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
      const automations = data.widget_config?.automations || {}
      const defaultWelcome = data.widget_config?.welcome_message || 'Hi! How can we help you today?'
      setFormData({
        name: data.name,
        domain: data.domain,
        widget_config: {
          theme: data.widget_config?.theme || 'dark',
          position: data.widget_config?.position || 'bottom-right',
          welcome_message: defaultWelcome,
          automations: {
            welcome_enabled: automations.welcome_enabled !== undefined ? !!automations.welcome_enabled : true,
            welcome_message: (automations.welcome_message || defaultWelcome) as string,
            welcome_cooldown_hours: typeof automations.welcome_cooldown_hours === 'number' ? automations.welcome_cooldown_hours : 24,
          },
          primary_color: data.widget_config?.primary_color || '#000000',
          header_title: data.widget_config?.header_title || 'How can we help?',
          online_status_text: data.widget_config?.online_status_text || 'We reply immediately',
          bubble_text: data.widget_config?.bubble_text || 'Chat',
          show_emoji_picker: data.widget_config?.show_emoji_picker !== undefined ? data.widget_config.show_emoji_picker : true,
          show_attachments: data.widget_config?.show_attachments || false,
          branding_text: data.widget_config?.branding_text ?? null,
          header_icon_url: data.widget_config?.header_icon_url ?? null,
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
    if (!confirm('Are you sure you want to delete this website? This action cannot be undone.')) {
      return
    }

    try {
      setSaving(true)
      await apiRequest(`/websites/${id}`, {
        method: 'DELETE',
      })
      navigate('/dashboard/settings/websites')
    } catch (err: any) {
      setError(err.message || 'Failed to delete website')
      setSaving(false)
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
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading website...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/dashboard/settings/websites')}
          className="gap-2 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Websites
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {isNew ? 'Add New Website' : 'Edit Website'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {isNew ? 'Configure a new website integration' : 'Update website configuration and widget settings'}
            </p>
          </div>
          {!isNew && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-800 dark:text-green-300">{successMessage}</p>
        </div>
      )}

      {!isNew && (
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('installation')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'installation'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
            >
              <Code className="w-4 h-4 inline-block mr-2 mb-1" />
              Installation
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'settings'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
            >
              <Settings className="w-4 h-4 inline-block mr-2 mb-1" />
              Settings
            </button>
            <button
              onClick={() => setActiveTab('widget')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'widget'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
            >
              <Palette className="w-4 h-4 inline-block mr-2 mb-1" />
              Widget Customization
            </button>
            <button
              onClick={() => setActiveTab('automations')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'automations'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
            >
              <Bot className="w-4 h-4 inline-block mr-2 mb-1" />
              Automations
            </button>
          </nav>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
        {/* Installation Tab */}
        {!isNew && activeTab === 'installation' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code className="w-5 h-5" />
                Installation
              </CardTitle>
              <CardDescription>Copy and paste this code into your website before the closing &lt;/body&gt; tag</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Website ID (internal)</p>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">{websiteId ?? '—'}</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Widget Key (public)</p>
                    <Button
                      type="button"
                      onClick={copyWidgetKey}
                      variant="outline"
                      size="sm"
                      disabled={!widgetKey}
                      className="h-7 px-2"
                    >
                      {widgetKeyCopied ? (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100 break-all">
                    {widgetKey || '—'}
                  </p>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700 relative">
                <Button
                  type="button"
                  onClick={copySnippet}
                  className="absolute top-2 right-2"
                  variant="outline"
                  size="sm"
                >
                  {snippetCopied ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
                <pre className="text-sm overflow-x-auto text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap pr-24">
                  {widgetSnippet || 'Loading...'}
                </pre>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                <p className="font-semibold">Installation Instructions:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Copy the code above</li>
                  <li>Paste it into your website's HTML before the closing &lt;/body&gt; tag</li>
                  <li>The chat widget will automatically appear on your website</li>
                  <li>Make sure at least one agent is assigned to this website</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Automations Tab */}
        {!isNew && activeTab === 'automations' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Automations
              </CardTitle>
              <CardDescription>Configure per-website auto messages and triggers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {automationsError && (
                <div className="p-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
                  {automationsError}
                </div>
              )}

              {automationsLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading automations…</div>
              ) : automations.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No automations found for this website.</div>
              ) : (
                <div className="space-y-4">
                  {automations.map((automation) => {
                    const action = extractPrimaryAction(automation)
                    const delay = Number(automation.conditions?.delay_seconds ?? 60)
                    const canEditDelay = automation.trigger === 'no_agent_assigned_for'

                    return (
                      <div key={automation.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{automation.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Trigger: {automation.trigger}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={automation.enabled}
                              onCheckedChange={(checked) => updateAutomationLocal(automation.id, { enabled: checked })}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => saveAutomation(automation)}
                              disabled={savingAutomationId === automation.id}
                            >
                              {savingAutomationId === automation.id ? 'Saving…' : 'Save'}
                            </Button>
                          </div>
                        </div>

                        {canEditDelay && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Wait time (seconds)
                              </label>
                              <Input
                                type="number"
                                min={1}
                                value={String(Number.isFinite(delay) ? delay : 60)}
                                onChange={(e) => {
                                  const nextDelay = Math.max(1, parseInt(e.target.value || '60', 10) || 60)
                                  updateAutomationLocal(automation.id, {
                                    conditions: { ...(automation.conditions || {}), delay_seconds: nextDelay },
                                  })
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Bot message
                          </label>
                          <Input
                            value={action?.message || ''}
                            onChange={(e) => {
                              const nextAction: AutomationAction = {
                                type: 'send_bot_message',
                                message: e.target.value,
                                event_type: action?.event_type,
                              }
                              updateAutomationLocal(automation.id, {
                                actions: updateAutomationAction(automation, nextAction),
                              })
                            }}
                            placeholder="Enter message..."
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Basic Settings Tab */}
        {(isNew || activeTab === 'settings') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Basic Information
              </CardTitle>
              <CardDescription>Website identification and domain</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Website Name *
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Website"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  A friendly name to identify this website
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Domain *
                </label>
                <Input
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="example.com"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  The domain where the chat widget will be embedded
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Widget Configuration Tab */}
        {!isNew && activeTab === 'widget' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Widget Customization
              </CardTitle>
              <CardDescription>Customize the chat widget appearance and behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Header Icon (Optional)
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                    {formData.widget_config.header_icon_url ? (
                      <img
                        src={`${API_BASE}${formData.widget_config.header_icon_url}`}
                        alt="Widget icon"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">None</span>
                    )}
                  </div>

                  {isAdmin(user) && (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUploadWidgetIcon(file)
                        e.currentTarget.value = ''
                      }}
                      className="text-sm text-gray-700 dark:text-gray-300"
                      disabled={saving}
                    />
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Shown as the single header icon until an agent joins (then agent avatar replaces it).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Theme
                  </label>
                  <select
                    value={formData.widget_config.theme}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, theme: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Position
                  </label>
                  <select
                    value={formData.widget_config.position}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, position: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="top-left">Top Left</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Header Title
                </label>
                <Input
                  value={formData.widget_config.header_title}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, header_title: e.target.value }
                  })}
                  placeholder="How can we help?"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Text shown in the widget header
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Online Status Text
                </label>
                <Input
                  value={formData.widget_config.online_status_text}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, online_status_text: e.target.value }
                  })}
                  placeholder="We reply immediately"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Status message shown below header
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Welcome Automation
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Sends a bot welcome message for new visitors, or when they return after the cooldown.
                    </p>
                  </div>
                  <Switch
                    checked={formData.widget_config.automations?.welcome_enabled ?? true}
                    onCheckedChange={(checked) => setFormData({
                      ...formData,
                      widget_config: {
                        ...formData.widget_config,
                        automations: {
                          ...(formData.widget_config.automations || {}),
                          welcome_enabled: checked,
                          welcome_message: (formData.widget_config.automations?.welcome_message || formData.widget_config.welcome_message) as string,
                          welcome_cooldown_hours: (formData.widget_config.automations?.welcome_cooldown_hours ?? 24) as number,
                        }
                      }
                    })}
                  />
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Welcome Message
                    </label>
                    <Input
                      value={(formData.widget_config.automations?.welcome_message || formData.widget_config.welcome_message) as string}
                      onChange={(e) => setFormData({
                        ...formData,
                        widget_config: {
                          ...formData.widget_config,
                          welcome_message: e.target.value,
                          automations: {
                            ...(formData.widget_config.automations || {}),
                            welcome_message: e.target.value,
                          }
                        }
                      })}
                      placeholder="Hi! How can we help you today?"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Cooldown (hours)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={String(formData.widget_config.automations?.welcome_cooldown_hours ?? 24)}
                      onChange={(e) => setFormData({
                        ...formData,
                        widget_config: {
                          ...formData.widget_config,
                          automations: {
                            ...(formData.widget_config.automations || {}),
                            welcome_cooldown_hours: Math.max(1, parseInt(e.target.value || '24', 10) || 24),
                          }
                        }
                      })}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bubble Text
                </label>
                <Input
                  value={formData.widget_config.bubble_text}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, bubble_text: e.target.value }
                  })}
                  placeholder="Chat"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Text shown on the minimized chat bubble
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Primary Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formData.widget_config.primary_color}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, primary_color: e.target.value }
                    })}
                    className="w-12 h-10 rounded border border-gray-300 dark:border-gray-600"
                  />
                  <Input
                    value={formData.widget_config.primary_color}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, primary_color: e.target.value }
                    })}
                    placeholder="#000000"
                    className="flex-1"
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Main color for header, buttons, and bubble
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Branding Text (Optional)
                </label>
                <Input
                  value={formData.widget_config.branding_text || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, branding_text: e.target.value || null }
                  })}
                  placeholder="Powered by Your Company"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Optional branding text shown at bottom of widget
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show_emoji_picker"
                    checked={formData.widget_config.show_emoji_picker}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, show_emoji_picker: e.target.checked }
                    })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="show_emoji_picker" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable Emoji Picker
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show_attachments"
                    checked={formData.widget_config.show_attachments}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, show_attachments: e.target.checked }
                    })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="show_attachments" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable File Attachments (Coming Soon)
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

        )}


        <div className="flex items-center gap-4">
          <Button type="submit" disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : isNew ? 'Create Website' : 'Save Changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/dashboard/settings/websites')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
