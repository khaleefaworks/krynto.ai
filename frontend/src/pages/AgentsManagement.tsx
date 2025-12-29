import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiRequest } from "@/services/api"
import { UserPlus, Trash2, Check, X } from "lucide-react"

interface Agent {
  id: number
  name: string
  email: string
  role: string
  is_available: boolean
  is_active: boolean
  created_at: string
}

export default function AgentsManagement() {
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
      // Filter out administrators (full_access role)
      setAgents(data.filter(user => user.role !== 'full_access'))
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

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Manage Agents</h1>
        <p className="text-gray-600 dark:text-gray-400">Loading agents...</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manage Agents</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Create and manage agent accounts who can handle customer chats
          </p>
        </div>
        {!showCreateForm && (
          <Button onClick={() => setShowCreateForm(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Agent
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
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Create New Agent</h2>
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
                  Create Agent
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

      {/* Agents List */}
      <div className="space-y-4">
        {agents.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-gray-400 dark:text-gray-600 mb-2">
              <UserPlus className="h-12 w-12 mx-auto mb-3" />
            </div>
            <p className="text-gray-600 dark:text-gray-400">No agents yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
              Create your first agent to start handling customer chats
            </p>
          </Card>
        ) : (
          agents.map((agent) => (
            <Card key={agent.id} className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {agent.name}
                    </h3>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      agent.is_active 
                        ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                    }`}>
                      {agent.is_active ? "Active" : "Inactive"}
                    </span>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      agent.is_available 
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                    }`}>
                      {agent.is_available ? "Available" : "Unavailable"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{agent.email}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Created: {new Date(agent.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleActive(agent)}
                    title={agent.is_active ? "Deactivate agent" : "Activate agent"}
                  >
                    {agent.is_active ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(agent)}
                    className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    title="Delete agent"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
