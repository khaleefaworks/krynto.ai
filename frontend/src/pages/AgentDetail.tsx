import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Camera, Loader2, Save, Trash2, User, Mail, Lock, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { API_BASE } from '@/config/endpoints'

interface Agent {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
  is_available: boolean
  avatar_url?: string | null
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAppStore()
  const isNew = id === 'new'

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'agent' as 'system_manager' | 'manager' | 'agent',
    is_active: true,
  })

  const [agent, setAgent] = useState<Agent | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)

  const isAdministratorAccount = Boolean(agent && agent.role === 'system_manager')

  const getFullAvatarUrl = (url: string | null | undefined): string | null => {
    const raw = String(url || '').trim()
    if (!raw) return null
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `${API_BASE}${raw}`
  }

  const uploadAvatarForUser = async (userId: number, file: File) => {
    try {
      setAvatarLoading(true)
      setError(null)
      setSuccessMessage(null)

      // Instant preview
      const reader = new FileReader()
      reader.onloadend = () => setAvatarPreview(reader.result as string)
      reader.readAsDataURL(file)

      const token = localStorage.getItem('auth_token')
      const form = new FormData()
      form.append('file', file)

      const res = await fetch(`${API_BASE}/users/${userId}/avatar/upload`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to upload avatar')
      }

      const data = await res.json().catch(() => ({}))
      const nextUrl = data.avatar_url ?? null
      setAgent((prev) => (prev ? { ...prev, avatar_url: nextUrl ?? prev.avatar_url } : prev))
      setAvatarPreview(getFullAvatarUrl(nextUrl))
      setSuccessMessage('Avatar updated successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar')
      setAvatarPreview(getFullAvatarUrl(agent?.avatar_url))
    } finally {
      setAvatarLoading(false)
    }
  }

  const deleteAvatarForUser = async (userId: number) => {
    try {
      setAvatarLoading(true)
      setError(null)
      setSuccessMessage(null)
      const data = await apiRequest<{ avatar_url: string | null }>(`/users/${userId}/avatar`, { method: 'DELETE' })
      setAgent((prev) => (prev ? { ...prev, avatar_url: data.avatar_url } : prev))
      setAvatarPreview(null)
      setSuccessMessage('Avatar removed successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar')
    } finally {
      setAvatarLoading(false)
    }
  }

  useEffect(() => {
    if (!isNew && id) {
      loadAgent()
    }
  }, [id, isNew])

  const loadAgent = async () => {
    try {
      setLoading(true)
      setError(null)
      // Load all agents and find the one we need
      const data = await apiRequest<Agent[]>('/users')
      const foundAgent = data.find(a => a.id === parseInt(id!))

      if (!foundAgent) {
        setError('Agent not found')
        return
      }

      setAgent(foundAgent)
      setAvatarPreview(getFullAvatarUrl(foundAgent.avatar_url))
      setFormData({
        name: foundAgent.name,
        email: foundAgent.email,
        password: '', // Never populate password
        role: foundAgent.role as 'system_manager' | 'manager' | 'agent',
        is_active: foundAgent.is_active,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to load agent')
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
        // Create new agent
        if (!formData.password) {
          setError('Password is required for new agents')
          setSaving(false)
          return
        }

        await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            password: formData.password,
            role: formData.role,
          }),
        })
        setSuccessMessage('Agent created successfully')
        setTimeout(() => navigate('/dashboard/settings/users'), 1500)
      } else {
        // Update existing user
        // Check if role changed
        const roleChanged = agent && agent.role !== formData.role

        if (roleChanged) {
          // Update role first
          await apiRequest(`/users/${id}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: formData.role }),
          })
        }

        // Update status if changed
        if (agent && agent.is_active !== formData.is_active) {
          await apiRequest(`/users/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: formData.is_active }),
          })
        }

        // Update email and/or name (name is set-once enforced server-side)
        if (agent) {
          const emailChanged = (agent.email || '').trim() !== (formData.email || '').trim()
          const nameChanged = (agent.name || '').trim() !== (formData.name || '').trim()
          if (emailChanged || nameChanged) {
            await apiRequest(`/users/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                ...(emailChanged ? { email: formData.email } : {}),
                ...(nameChanged ? { name: formData.name } : {}),
              }),
            })
          }
        }

        setSuccessMessage('User updated successfully')
        loadAgent()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save agent')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this agent? This action cannot be undone.')) {
      return
    }

    try {
      setSaving(true)
      await apiRequest(`/users/${id}`, {
        method: 'DELETE',
      })
      navigate('/dashboard/settings/users')
    } catch (err: any) {
      setError(err.message || 'Failed to delete agent')
      setSaving(false)
    }
  }

  const toggleStatus = async () => {
    if (isAdministratorAccount) {
      setError('Administrator account cannot be disabled')
      return
    }
    try {
      setSaving(true)
      setError(null)
      await apiRequest(`/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !formData.is_active }),
      })
      setFormData({ ...formData, is_active: !formData.is_active })
      setSuccessMessage(`Agent ${!formData.is_active ? 'activated' : 'deactivated'} successfully`)
      loadAgent()
    } catch (err: any) {
      setError(err.message || 'Failed to update agent status')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading user...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center justify-between gap-4 border-b dark:border-gray-700 px-6 flex-shrink-0">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {isNew ? 'Add New User' : (agent?.name || 'Edit User')}
        </h1>
        {!isNew && (
          <div className="flex items-center gap-2">
            <Button
              variant={formData.is_active ? 'outline' : 'default'}
              size="sm"
              onClick={toggleStatus}
              disabled={saving || isAdministratorAccount}
              className="gap-1"
            >
              {formData.is_active ? (
                <>
                  <XCircle className="w-3.5 h-3.5" />
                  Deactivate
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Activate
                </>
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={saving}
              className="gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto py-8">
        <div className="max-w-2xl w-full mx-auto px-6 space-y-6">
          {(error || successMessage) && (
            <div
              className={`p-3 rounded-lg text-sm border ${error
                ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800'
                : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800'
                }`}
            >
              {error || successMessage}
            </div>
          )}

          {/* Identity + Avatar (admin-only, existing users) */}
          {!isNew && agent && isAdmin(currentUser) && (
            <div className="flex flex-col items-center text-center">
              <div className="relative group mb-4">
                <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-gray-100 dark:ring-gray-700">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt={agent.name || 'Avatar'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">
                        {(agent.name || '?').trim().charAt(0).toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving || avatarLoading}
                  className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all"
                  title="Change avatar"
                >
                  {avatarLoading ? (
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    // reset so the same file can be re-selected
                    if (fileInputRef.current) fileInputRef.current.value = ''
                    if (!file) return
                    if (!file.type.startsWith('image/')) {
                      setError('Please select an image file.')
                      return
                    }
                    if (file.size > 5 * 1024 * 1024) {
                      setError('Image must be under 5 MB.')
                      return
                    }
                    uploadAvatarForUser(agent.id, file)
                  }}
                  className="sr-only"
                  disabled={saving || avatarLoading}
                />
                {avatarPreview && !avatarLoading && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm("Remove this user's avatar?")) return
                      deleteAvatarForUser(agent.id)
                    }}
                    disabled={saving}
                    className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center shadow-sm hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors group/del"
                    title="Remove avatar"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-gray-400 group-hover/del:text-red-500 transition-colors" />
                  </button>
                )}
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{agent.name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{agent.email}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {agent.role === 'system_manager' ? 'System Manager' : agent.role === 'manager' ? 'Manager' : 'Agent'}
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${formData.is_active
                  ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
                  : 'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                  }`}>
                  {formData.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  User Information
                </CardTitle>
                <CardDescription>
                  {isNew ? 'Enter details for the new user account' : 'User account details'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Current Status - Only for existing users */}
                {!isNew && agent && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800/40">
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Account Status</span>
                      <Badge variant={formData.is_active ? 'default' : 'destructive'} className="gap-1">
                        {formData.is_active ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            Active
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            Inactive
                          </>
                        )}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Availability</span>
                      <Badge variant={agent.is_available ? 'default' : 'secondary'}>
                        {agent.is_available ? 'Available' : 'Unavailable'}
                      </Badge>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name *
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="John Doe"
                    required
                    disabled={!isNew && Boolean(agent?.name && agent.name.trim())}
                  />
                  {!isNew && Boolean(agent?.name && agent.name.trim()) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Name cannot be changed after creation
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Mail className="w-4 h-4 inline mr-1" />
                    Email Address *
                  </label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                    required
                    disabled={saving}
                  />
                </div>

                {isNew && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      <Lock className="w-4 h-4 inline mr-1" />
                      Password *
                    </label>
                    <Input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="••••••••"
                      required={isNew}
                      minLength={6}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum 6 characters</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Role *
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as 'system_manager' | 'manager' | 'agent' })}
                    className="w-full h-10 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white/70 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    required
                    disabled={saving || (!isNew && isAdministratorAccount)}
                  >
                    {isAdministratorAccount ? (
                      <option value="system_manager">System Manager - Full system access</option>
                    ) : (
                      <>
                        <option value="agent">Agent - Chat handling only</option>
                        <option value="manager">Manager - Full access except reset</option>
                      </>
                    )}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {isNew
                      ? 'Determines user permissions and access level'
                      : isAdministratorAccount
                        ? 'Administrator account role is fixed (bootstrap-only)'
                        : 'Change user role to update permissions'}
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={saving} className="gap-2">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : isNew ? 'Create User' : 'Save Changes'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate('/dashboard/settings/users')}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
