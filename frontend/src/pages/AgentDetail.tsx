import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Save, Trash2, User, Mail, Lock, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { useAppStore } from '@/store/appStore'
import { isAdministrator } from '@/lib/roles'

interface Agent {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
  is_available: boolean
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
    role: 'agent' as 'full_access' | 'manager' | 'agent',
    is_active: true,
  })

  const [agent, setAgent] = useState<Agent | null>(null)

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
      const data = await apiRequest<Agent[]>('/auth/users')
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
        role: foundAgent.role as 'full_access' | 'manager' | 'agent',
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
        setTimeout(() => navigate('/dashboard/settings/agents'), 1500)
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
      navigate('/dashboard/settings/agents')
    } catch (err: any) {
      setError(err.message || 'Failed to delete agent')
      setSaving(false)
    }
  }

  const toggleStatus = async () => {
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
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading user...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/dashboard/settings/agents')}
          className="gap-2 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {isNew ? 'Add New User' : 'Edit User'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {isNew ? 'Create a new user account' : 'Update user account details'}
            </p>
          </div>
          {!isNew && (
            <div className="flex items-center gap-4">
              <Button
                variant={formData.is_active ? 'outline' : 'default'}
                onClick={toggleStatus}
                disabled={saving}
                className="gap-2"
              >
                {formData.is_active ? (
                  <>
                    <XCircle className="w-4 h-4" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Activate
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={saving}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            </div>
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

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
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
                disabled={!isNew}
              />
              {!isNew && (
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
                disabled={!isNew}
              />
              {!isNew && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Email cannot be changed after creation
                </p>
              )}
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
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'full_access' | 'manager' | 'agent' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
                disabled={!isNew && agent?.role === 'full_access' && !isAdministrator(currentUser)}
              >
                <option value="agent">Agent - Chat handling only</option>
                <option value="manager">Manager - Full access except reset</option>
                {/* Only administrators can create/modify administrator role */}
                {isAdministrator(currentUser) && (
                  <option value="full_access">Administrator - Full system access</option>
                )}
                {/* Show current administrator role if editing an admin (but disabled) */}
                {!isAdministrator(currentUser) && agent?.role === 'full_access' && (
                  <option value="full_access" disabled>Administrator - Full system access</option>
                )}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {isNew 
                  ? 'Determines user permissions and access level'
                  : !isAdministrator(currentUser) && agent?.role === 'full_access'
                    ? 'Only administrators can modify administrator accounts'
                    : 'Change user role to update permissions'
                }
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : isNew ? 'Create User' : 'Save Changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/dashboard/settings/agents')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
