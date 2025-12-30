import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Save, Trash2, Globe } from 'lucide-react'

interface Website {
  id: number
  name: string
  domain: string
  ai_enabled: boolean
  ai_instructions: string | null
  widget_config: {
    theme?: string
    position?: string
    welcome_message?: string
    primary_color?: string
  } | null
  created_at: string
}

export default function WebsiteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'
  
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    ai_enabled: true,
    ai_instructions: '',
    widget_config: {
      theme: 'dark',
      position: 'bottom-right',
      welcome_message: 'Hi! How can we help you today?',
      primary_color: '#000000',
    }
  })

  useEffect(() => {
    if (!isNew && id) {
      loadWebsite()
    }
  }, [id, isNew])

  const loadWebsite = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<Website>(`/websites/${id}`)
      setFormData({
        name: data.name,
        domain: data.domain,
        ai_enabled: data.ai_enabled,
        ai_instructions: data.ai_instructions || '',
        widget_config: {
          theme: data.widget_config?.theme || 'dark',
          position: data.widget_config?.position || 'bottom-right',
          welcome_message: data.widget_config?.welcome_message || 'Hi! How can we help you today?',
          primary_color: data.widget_config?.primary_color || '#000000',
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
        loadWebsite()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save website')
    } finally {
      setSaving(false)
    }
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

      <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
        {/* Basic Information */}
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

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ai_enabled"
                checked={formData.ai_enabled}
                onChange={(e) => setFormData({ ...formData, ai_enabled: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="ai_enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable AI Responses
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                AI Instructions
              </label>
              <textarea
                value={formData.ai_instructions}
                onChange={(e) => setFormData({ ...formData, ai_instructions: e.target.value })}
                placeholder="Instructions for the AI assistant..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Optional instructions to guide the AI's responses
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Widget Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Widget Configuration</CardTitle>
            <CardDescription>Customize the chat widget appearance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <option value="light">Light</option>
                <option value="dark">Dark</option>
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
              </select>
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
            </div>
          </CardContent>
        </Card>

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
