import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Plus, User, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Switch } from '@/components/ui/switch'
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

export default function AgentsList() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAgents()
  }, [])

  const loadAgents = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<Agent[]>('/users')
      // Show all users (don't filter by role)
      setAgents(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleRowClick = (agentId: number) => {
    navigate(`/dashboard/settings/users/${agentId}`)
  }

  const getFullAvatarUrl = (url: string | null | undefined): string | null => {
    const raw = String(url || '').trim()
    if (!raw) return null
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `${API_BASE}${raw}`
  }

  const toggleActive = async (agentId: number, isActive: boolean) => {
    setAgents(prev => prev.map(a => (a.id === agentId ? { ...a, is_active: isActive } : a)))
    try {
      await apiRequest(`/users/${agentId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: isActive }),
      })
    } catch (err) {
      // revert on error
      setAgents(prev => prev.map(a => (a.id === agentId ? { ...a, is_active: !isActive } : a)))
      throw err
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading agents...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage user accounts and roles
          </p>
        </div>
        <Button onClick={() => navigate('/dashboard/settings/users/new')} className="gap-2">
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <User className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No users yet</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Create your first user account
          </p>
          <Button onClick={() => navigate('/dashboard/settings/users/new')} className="gap-2">
            <Plus className="w-4 h-4" />
            Add User
          </Button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {agents.map((agent) => (
                (() => {
                  const isAdministrator = String(agent.role || '') === 'system_manager'
                  const avatar = getFullAvatarUrl(agent.avatar_url)
                  const initials = String(agent.name || '?').trim().charAt(0).toUpperCase() || '?'

                  return (
                <tr
                  key={agent.id}
                  onClick={() => handleRowClick(agent.id)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={agent.name}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium">
                          {initials}
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {agent.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {agent.email}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={isAdministrator ? true : agent.is_active}
                        disabled={isAdministrator}
                        onCheckedChange={(checked) => {
                          // prevent row click navigation
                          toggleActive(agent.id, checked).catch((e: any) => {
                            setError(e?.message || 'Failed to update user status')
                          })
                        }}
                      />
                      <Badge variant={(isAdministrator ? true : agent.is_active) ? 'default' : 'destructive'} className="gap-1">
                        {(isAdministrator ? true : agent.is_active) ? (
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
                  </td>
                </tr>
                  )
                })()
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
