import { useState, useEffect, useRef, useMemo } from 'react'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Plus, X, Trash2, Users, Search, Mail, Lock, Camera, Loader2, Eye, EyeOff } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'
import { addMessageHandler } from '@/services/agentSocket'
import { useAppStore } from '@/store/appStore'

interface Agent {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
  is_available: boolean
  is_connected?: boolean
  can_receive_chats?: boolean
  avatar_url?: string | null
}

type PanelMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; item: Agent }

export default function AgentsList() {
  const { user: currentUser } = useAppStore()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Panel state
  const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' })
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formRole, setFormRole] = useState<'owner' | 'manager' | 'agent' | 'system_manager'>('agent')

  // Password reveal toggles
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)

  // ─── Data ─────────────────────────────────────────────
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const refresh = async () => {
    const data = await apiRequest<Agent[]>('/users')
    setAgents(data)
  }
  refreshRef.current = refresh

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        await refresh()
      } catch (err: any) {
        if (cancelled) return
        setError(err.message || 'Failed to load users')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  // Listen for real-time availability changes — silent re-fetch (no loading flicker)
  useEffect(() => {
    const removeHandler = addMessageHandler((data: any) => {
      if (data?.type === 'availability_changed') {
        refreshRef.current().catch(() => { })
      }
    })
    return removeHandler
  }, [])

  const filtered = useMemo(() => {
    const list = [...agents].sort((a, b) => a.name.localeCompare(b.name))
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(a =>
      a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    )
  }, [agents, search])

  // ─── Helpers ──────────────────────────────────────────
  const getFullAvatarUrl = (url: string | null | undefined): string | null => {
    const raw = String(url || '').trim()
    if (!raw) return null
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `${API_BASE}${raw}`
  }

  const roleLabel = (role: string) => {
    if (role === 'system_manager') return 'System Manager'
    if (role === 'owner') return 'Owner'
    if (role === 'manager') return 'Manager'
    return 'Agent'
  }

  // ─── Panel helpers ────────────────────────────────────
  const resetPasswordState = () => {
    setFormPassword('')
    setShowCreatePassword(false)
    setShowNewPassword(false)
  }

  const openCreate = () => {
    setFormName('')
    setFormEmail('')
    setFormRole('agent')
    setAvatarPreview(null)
    setError(null)
    resetPasswordState()
    setPanel({ kind: 'create' })
  }

  const openEdit = (item: Agent) => {
    setFormName(item.name)
    setFormEmail(item.email)
    setFormRole(item.role as 'owner' | 'manager' | 'agent' | 'system_manager')
    setAvatarPreview(getFullAvatarUrl(item.avatar_url))
    setError(null)
    resetPasswordState()
    setPanel({ kind: 'edit', item })
  }

  const closePanel = () => {
    resetPasswordState()
    setPanel({ kind: 'closed' })
  }

  // Escape closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panel.kind !== 'closed') closePanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [panel.kind])

  // ─── Inline status toggle ────────────────────────────
  const toggleActive = async (agent: Agent, isActive: boolean) => {
    if (agent.role === 'system_manager') return
    if (agent.id === currentUser?.id) return
    setAgents(prev => prev.map(a => (a.id === agent.id ? { ...a, is_active: isActive } : a)))
    try {
      await apiRequest(`/users/${agent.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: isActive }),
      })
    } catch (err: any) {
      setAgents(prev => prev.map(a => (a.id === agent.id ? { ...a, is_active: !isActive } : a)))
      setError(err?.message || 'Failed to update user status')
    }
  }

  // ─── Avatar ───────────────────────────────────────────
  const uploadAvatar = async (userId: number, file: File) => {
    try {
      setAvatarLoading(true)
      setError(null)

      const reader = new FileReader()
      reader.onloadend = () => setAvatarPreview(reader.result as string)
      reader.readAsDataURL(file)

      const token = localStorage.getItem('auth_token')
      const form = new FormData()
      form.append('file', file)

      const res = await fetch(`${API_BASE}/users/${userId}/avatar/upload`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to upload avatar')
      }

      const data = await res.json().catch(() => ({}))
      const nextUrl = data.avatar_url ?? null
      setAgents(prev => prev.map(a => a.id === userId ? { ...a, avatar_url: nextUrl } : a))
      setAvatarPreview(getFullAvatarUrl(nextUrl))
      if (panel.kind === 'edit') {
        setPanel({ kind: 'edit', item: { ...panel.item, avatar_url: nextUrl } })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar')
      if (panel.kind === 'edit') setAvatarPreview(getFullAvatarUrl(panel.item.avatar_url))
    } finally {
      setAvatarLoading(false)
    }
  }

  const deleteAvatar = async (userId: number) => {
    try {
      setAvatarLoading(true)
      setError(null)
      const data = await apiRequest<{ avatar_url: string | null }>(`/users/${userId}/avatar`, { method: 'DELETE' })
      setAgents(prev => prev.map(a => a.id === userId ? { ...a, avatar_url: data.avatar_url } : a))
      setAvatarPreview(null)
      if (panel.kind === 'edit') {
        setPanel({ kind: 'edit', item: { ...panel.item, avatar_url: null } })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar')
    } finally {
      setAvatarLoading(false)
    }
  }

  // ─── CRUD ─────────────────────────────────────────────
  const handleSave = async () => {
    const name = formName.trim()
    const email = formEmail.trim()
    if (!name || !email) {
      setError('Name and email are required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (panel.kind === 'create') {
        if (!formPassword.trim()) {
          setError('Password is required for new users.')
          setSaving(false)
          return
        }
        await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password: formPassword, role: formRole }),
        })
        await refresh()
        closePanel()
      } else if (panel.kind === 'edit') {
        const item = panel.item
        const isSystemMgr = item.role === 'system_manager'

        if (!isSystemMgr && item.role !== formRole) {
          await apiRequest(`/users/${item.id}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: formRole }),
          })
        }

        const emailChanged = (item.email || '').trim() !== email
        const nameChanged = (item.name || '').trim() !== name
        if (emailChanged || nameChanged) {
          await apiRequest(`/users/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ email, ...(nameChanged && { name }) }),
          })
        }

        if (formPassword.trim()) {
          await apiRequest(`/users/${item.id}/password`, {
            method: 'PATCH',
            body: JSON.stringify({ new_password: formPassword.trim() }),
          })
        }

        await refresh()
        closePanel()
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to save user.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (panel.kind !== 'edit') return
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return
    const item = panel.item
    setDeleting(true)
    setError(null)
    try {
      await apiRequest<void>(`/users/${item.id}`, { method: 'DELETE' })
      setAgents(prev => prev.filter(a => a.id !== item.id))
      closePanel()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete user.')
    } finally {
      setDeleting(false)
    }
  }

  const panelOpen = panel.kind !== 'closed'
  // Derive editItem from live agents state so realtime updates are reflected
  const editItem = panel.kind === 'edit'
    ? agents.find(a => a.id === panel.item.id) ?? panel.item
    : null
  const isAdminAccount = editItem?.role === 'system_manager'
  const isOwnerAccount = editItem?.role === 'owner'
  const currentRole = currentUser?.role
  const ownerCount = agents.filter(a => a.role === 'owner').length
  const isSelfAccount = Boolean(editItem && currentUser && editItem.id === currentUser.id)
  const isLastRemainingOwner = Boolean(editItem && editItem.role === 'owner' && ownerCount <= 1)
  const canDeleteByRole = Boolean(
    editItem && (
      currentRole === 'system_manager' ||
      currentRole === 'owner' ||
      (currentRole === 'manager' && editItem.role !== 'owner')
    )
  )
  const canDelete = Boolean(
    editItem &&
    !isSelfAccount &&
    // Never allow deleting a system manager from the UI
    !isAdminAccount &&
    !isLastRemainingOwner &&
    canDeleteByRole
  )
  const deleteBlockedReason = isAdminAccount
    ? 'Administrator account cannot be deleted.'
    : isSelfAccount
      ? 'Cannot delete your own account.'
      : isLastRemainingOwner
        ? 'Their should be atleast 1 owner'
        : !canDeleteByRole
          ? 'You do not have permission to delete this user.'
          : null

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Header */}
      <div className="h-16 flex items-center justify-between border-b dark:border-gray-700 px-6 flex-shrink-0">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Users</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add User
        </Button>
      </div>

      {/* Subtitle + Search */}
      <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage team members and their roles.
        </p>
        {agents.length > 0 && (
          <div className="relative flex-shrink-0 w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 h-8 text-sm dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {error && panel.kind === 'closed' && (
          <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 && !search.trim() ? (
          <div className="py-16 text-center">
            <Users className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No users yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Create your first user account.</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add User
            </Button>
          </div>
        ) : filtered.length === 0 && search.trim() ? (
          <div className="py-16 text-center text-sm text-gray-400">No users matching &ldquo;{search}&rdquo;</div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">User</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-40">Role</th>
                  <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-20">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map(agent => {
                  const isSysManager = agent.role === 'system_manager'
                  const isOwner = agent.role === 'owner'
                  const isSelf = agent.id === currentUser?.id
                  const avatar = getFullAvatarUrl(agent.avatar_url)
                  const initials = (agent.name || '?').trim().charAt(0).toUpperCase()

                  return (
                    <tr
                      key={agent.id}
                      onClick={() => openEdit(agent)}
                      className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            {avatar ? (
                              <img src={avatar} alt={agent.name} className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium">
                                {initials}
                              </div>
                            )}
                            <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-2 border-white dark:border-gray-800 rounded-full ${agent.can_receive_chats ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          </div>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{agent.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{agent.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isSysManager
                          ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                          : agent.role === 'owner'
                            ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            : agent.role === 'manager'
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400'
                          }`}>
                          {roleLabel(agent.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <Switch
                          checked={isSysManager || isOwner || isSelf ? true : agent.is_active}
                          disabled={isSysManager || isOwner || isSelf}
                          onCheckedChange={checked => toggleActive(agent, checked)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Slide-over panel ─── */}
      {panelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10"
            onClick={closePanel}
          />
          {/* Panel */}
          <div
            ref={panelRef}
            className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200"
          >
            {/* Panel header */}
            <div className="h-16 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {panel.kind === 'create' ? 'New User' : editItem?.name || 'Edit User'}
              </h2>
              <button
                type="button"
                onClick={closePanel}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-auto p-5 space-y-5">
              {error && (
                <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                  {error}
                </div>
              )}

              {/* Avatar (edit mode only) */}
              {panel.kind === 'edit' && editItem && (
                <div className="flex flex-col items-center pb-2">
                  <div className="relative group">
                    <div className="w-20 h-20 rounded-full overflow-hidden ring-4 ring-gray-100 dark:ring-gray-700">
                      {avatarPreview ? (
                        <img src={avatarPreview} alt={editItem.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                          <span className="text-xl font-bold text-white">
                            {(editItem.name || '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={avatarLoading}
                      className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all"
                      title="Change avatar"
                    >
                      {avatarLoading ? (
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (fileInputRef.current) fileInputRef.current.value = ''
                        if (!file) return
                        if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return }
                        if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5 MB.'); return }
                        uploadAvatar(editItem.id, file)
                      }}
                      className="sr-only"
                      disabled={avatarLoading}
                    />
                    {avatarPreview && !avatarLoading && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirm("Remove this user's avatar?")) return
                          deleteAvatar(editItem.id)
                        }}
                        className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center shadow-sm hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors group/del"
                        title="Remove avatar"
                      >
                        <Trash2 className="h-3 w-3 text-gray-400 group-hover/del:text-red-500 transition-colors" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Click to change photo</p>
                </div>
              )}

              {/* Info badges (edit mode) */}
              {panel.kind === 'edit' && editItem && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800/40">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Status</span>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${editItem.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${editItem.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {editItem.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Availability</span>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${editItem.can_receive_chats ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${editItem.can_receive_chats ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {editItem.can_receive_chats ? 'Available' : 'Not Available'}
                    </span>
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Full Name</label>
                <Input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="John Doe"
                  className="dark:bg-gray-800 dark:border-gray-700"
                  autoFocus={panel.kind === 'create'}
                />
              </div>

              {/* Email */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                  <Mail className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                  Email Address
                </label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="dark:bg-gray-800 dark:border-gray-700"
                />
              </div>

              {/* Password (create: required; edit: optional reset) */}
              {panel.kind === 'create' ? (
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                    <Lock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showCreatePassword ? 'text' : 'password'}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pr-10 dark:bg-gray-800 dark:border-gray-700"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      tabIndex={-1}
                    >
                      {showCreatePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Minimum 6 characters.</p>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Reset Password</p>
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                      New Password
                    </label>
                    <div className="relative">
                      <Input
                        type={showNewPassword ? 'text' : 'password'}
                        value={formPassword}
                        onChange={e => setFormPassword(e.target.value)}
                        placeholder="Leave blank to keep current password"
                        className="pr-10 dark:bg-gray-800 dark:border-gray-700"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        tabIndex={-1}
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Min. 6 characters. Leave blank to keep the current password.</p>
                  </div>
                </div>
              )}

              {/* Role */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Role</label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value as 'owner' | 'manager' | 'agent' | 'system_manager')}
                  className="w-full h-10 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  disabled={saving || isAdminAccount || isOwnerAccount}
                >
                  {isAdminAccount ? (
                    <option value="system_manager">System Manager – Full system access</option>
                  ) : (
                    <>
                      <option value="owner">Owner – Full org control</option>
                      <option value="manager">Manager – Full access except ownership</option>
                      <option value="agent">Agent – Chat handling only</option>
                    </>
                  )}
                </select>
                {isAdminAccount && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Administrator role cannot be changed.</p>
                )}
              </div>
            </div>

            {/* Panel footer */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 flex-shrink-0">
              <div className="flex items-center justify-between">
                {panel.kind === 'edit' && !isAdminAccount ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || !canDelete}
                    title={deleteBlockedReason || undefined}
                    className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={closePanel}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !formName.trim() || !formEmail.trim() || (panel.kind === 'create' && !formPassword.trim())}
                  >
                    {saving ? 'Saving…' : panel.kind === 'create' ? 'Create User' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
