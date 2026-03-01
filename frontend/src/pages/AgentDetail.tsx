import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Save, Trash2, User, Mail, Lock, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { useAppStore } from '@/store/appStore'
import { isAdministrator, isAdmin } from '@/lib/roles'
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

  const isAdministratorAccount = Boolean(agent && agent.role === 'system_manager')

  const uploadAvatarForUser = async (userId: number, file: File) => {
    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)

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
      setAgent((prev) => (prev ? { ...prev, avatar_url: data.avatar_url ?? prev.avatar_url } : prev))
      setSuccessMessage('Avatar updated successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar')
    } finally {
      setSaving(false)
    }
  }

  const deleteAvatarForUser = async (userId: number) => {
    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)
      const data = await apiRequest<{ avatar_url: string | null }>(`/users/${userId}/avatar`, { method: 'DELETE' })
      setAgent((prev) => (prev ? { ...prev, avatar_url: data.avatar_url } : prev))
      setSuccessMessage('Avatar removed successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar')
    } finally {
      setSaving(false)
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
    <div>
      <div className="h-16 flex items-center justify-between gap-4 border-b dark:border-gray-700 px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/dashboard/settings/users')}
            className="gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {isNew ? 'Add New User' : 'Edit User'}
          </h1>
        </div>
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

      {!isNew && agent && isAdmin(currentUser) && (
        <Card className="p-4 mx-6 mt-4">
          <h2 className="text-base font-semibold mb-3 text-gray-900 dark:text-white">Avatar</h2>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
              {agent.avatar_url ? (
                <img
                  src={`${API_BASE}${agent.avatar_url}`}
                  alt="User avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">No avatar</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadAvatarForUser(agent.id, file)
                  e.currentTarget.value = ''
                }}
                className="text-sm text-gray-700 dark:text-gray-300"
                disabled={saving}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!confirm('Remove this user\'s avatar?')) return
                  deleteAvatarForUser(agent.id)
                }}
                disabled={saving || !agent.avatar_url}
              >
                Remove
              </Button>
            </div>
          </div>
        </Card>
      )
      }

      {
        error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )
      }

      {
        successMessage && (
          <div className="mx-6 mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-300">{successMessage}</p>
          </div>
        )
      }

      <form onSubmit={handleSave} className="space-y-4 max-w-2xl px-6 py-4">
        {/* Agent Information */}
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
            {/* Current Status - Only for existing agents */}
            {!isNew && agent && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Account Status</span>
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
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Availability</span>
                  <Badge variant={agent.is_available ? 'default' : 'secondary'}>
                    {agent.is_available ? 'Available' : 'Unavailable'}
                  </Badge>
                </div>
              </div>
            )}

            {/* Name */}
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

            {/* Email */}
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

            {/* Password - Only for new users */}
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Minimum 6 characters
                </p>
              </div>
            )}

            {/* Role Selection - For both new and existing users */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Role *
              </label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'system_manager' | 'manager' | 'agent' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
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
    </div >
  )
}
