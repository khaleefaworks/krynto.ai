import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiRequest } from "@/services/api"
import { UserPlus, Trash2, Check, X } from "lucide-react"
import { useAppStore } from "@/store/appStore"
import { isAdmin } from "@/lib/roles"
import { API_BASE } from "@/config/endpoints"

interface Agent {
  id: number
  name: string
  email: string
  role: string
  is_available: boolean
  is_active: boolean
  avatar_url?: string | null
  created_at: string
}

export default function AgentsManagement() {
  const { user } = useAppStore()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  })

  useEffect(() => {
    loadAgents()
  }, [])

  const loadAgents = async () => {
    try {
      setLoading(true)
      setError(null)
      // Fetch all users except administrators
      const data = await apiRequest<Agent[]>("/users")
      // Filter out system managers (system_manager role)
      setAgents(data.filter(user => user.role !== 'system_manager'))
    } catch (err: any) {
      setError(err.message || "Failed to load agents")
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setError(null)
      setSuccess(null)

      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          ...formData,
          role: "limited_access", // Agent role
        }),
      })

      setSuccess("Agent created successfully")
      setShowCreateForm(false)
      setFormData({ name: "", email: "", password: "" })
      await loadAgents()
    } catch (err: any) {
      setError(err.message || "Failed to create agent")
    }
  }

  const handleToggleActive = async (agent: Agent) => {
    try {
      setError(null)
      await apiRequest(`/users/${agent.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !agent.is_active }),
      })
      await loadAgents()
    } catch (err: any) {
      setError(err.message || "Failed to update agent status")
    }
  }

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Are you sure you want to delete agent "${agent.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      setError(null)
      await apiRequest(`/users/${agent.id}`, {
        method: "DELETE",
      })
      setSuccess("Agent deleted successfully")
      await loadAgents()
    } catch (err: any) {
      setError(err.message || "Failed to delete agent")
    }
  }

  const uploadAvatarForUser = async (userId: number, file: File) => {
    try {
      setError(null)
      setSuccess(null)

      const token = localStorage.getItem("auth_token")
      const form = new FormData()
      form.append("file", file)

      const res = await fetch(`${API_BASE}/users/${userId}/avatar/upload`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Failed to upload avatar")
      }

      setSuccess("Avatar updated successfully")
      await loadAgents()
    } catch (err: any) {
      setError(err.message || "Failed to upload avatar")
    }
  }

  const deleteAvatarForUser = async (userId: number) => {
    try {
      setError(null)
      setSuccess(null)
      await apiRequest(`/users/${userId}/avatar`, { method: "DELETE" })
      setSuccess("Avatar removed successfully")
      await loadAgents()
    } catch (err: any) {
      setError(err.message || "Failed to remove avatar")
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Users</h1>
        <p className="text-gray-600 dark:text-gray-400">Loading users...</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage user accounts and roles
          </p>
        </div>
        {!showCreateForm && (
          <Button onClick={() => setShowCreateForm(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md text-green-800 dark:text-green-300">
          {success}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Create New User</h2>
          <form onSubmit={handleCreate}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
                  Full Name *
                </label>
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Doe"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
                  Email *
                </label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="agent@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
                  Password *
                </label>
                <Input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Enter secure password"
                  required
                  minLength={6}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Minimum 6 characters
                </p>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  Create User
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowCreateForm(false)
                    setFormData({ name: "", email: "", password: "" })
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        {agents.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-gray-400 dark:text-gray-600 mb-2">
              <UserPlus className="h-12 w-12 mx-auto mb-3" />
            </div>
            <p className="text-gray-600 dark:text-gray-400">No users yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
              Create your first user to start handling customer chats
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Avatar
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  className="border-b border-gray-200 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                    {agent.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                        {agent.avatar_url ? (
                          <img
                            src={`${API_BASE}${agent.avatar_url}`}
                            alt={`${agent.name} avatar`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
                        )}
                      </div>

                      {isAdmin(user) && (
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) uploadAvatarForUser(agent.id, file)
                              e.currentTarget.value = ""
                            }}
                            className="text-sm"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (!confirm(`Remove avatar for "${agent.name}"?`)) return
                              deleteAvatarForUser(agent.id)
                            }}
                            disabled={!agent.avatar_url}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {agent.email}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${agent.is_active
                        ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                      }`}>
                      {agent.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
