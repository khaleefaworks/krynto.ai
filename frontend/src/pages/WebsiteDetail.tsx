import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { ArrowLeft, Save, Trash2, Globe, Code, Settings, Palette, Copy, Check } from 'lucide-react'

interface Website {
  id: number
  name: string
  domain: string
  widget_key?: string
  widget_config: {
    theme?: string
    position?: string
    welcome_message?: string
    primary_color?: string
    header_title?: string
    online_status_text?: string
    bubble_text?: string
    show_emoji_picker?: boolean
    show_attachments?: boolean
    branding_text?: string | null
  } | null
  created_at: string
}

type TabType = 'installation' | 'settings' | 'widget'

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
  const [widgetSnippet, setWidgetSnippet] = useState('')

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    widget_config: {
      theme: 'dark',
      position: 'bottom-right',
      welcome_message: 'Hi! How can we help you today?',
      primary_color: '#000000',
      header_title: 'How can we help?',
      online_status_text: 'We reply immediately',
      bubble_text: 'Chat',
      show_emoji_picker: true,
      show_attachments: false,
      branding_text: null,
    }
  })

  useEffect(() => {
    if (!isNew && id) {
      loadWebsite()
      loadSnippet()
    }
  }, [id, isNew])

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
      setFormData({
        name: data.name,
        domain: data.domain,
        widget_config: {
          theme: data.widget_config?.theme || 'dark',
          position: data.widget_config?.position || 'bottom-right',
          welcome_message: data.widget_config?.welcome_message || 'Hi! How can we help you today?',
          primary_color: data.widget_config?.primary_color || '#000000',
          header_title: data.widget_config?.header_title || 'How can we help?',
          online_status_text: data.widget_config?.online_status_text || 'We reply immediately',
          bubble_text: data.widget_config?.bubble_text || 'Chat',
          show_emoji_picker: data.widget_config?.show_emoji_picker !== undefined ? data.widget_config.show_emoji_picker : true,
          show_attachments: data.widget_config?.show_attachments || false,
          branding_text: data.widget_config?.branding_text || null,
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
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'installation'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <Code className="w-4 h-4 inline-block mr-2 mb-1" />
              Installation
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'settings'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <Settings className="w-4 h-4 inline-block mr-2 mb-1" />
              Settings
            </button>
            <button
              onClick={() => setActiveTab('widget')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'widget'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <Palette className="w-4 h-4 inline-block mr-2 mb-1" />
              Widget Customization
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Welcome Message
              </label>
              <Input
                value={formData.widget_config.welcome_message}
                onChange={(e) => setFormData({
                  ...formData,
                  widget_config: { ...formData.widget_config, welcome_message: e.target.value }
                })}
                placeholder="Hi! How can we help you today?"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                First message shown to visitors
              </p>
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
