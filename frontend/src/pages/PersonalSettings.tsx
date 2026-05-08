import { useState, useEffect, useRef } from "react"
import { useAppStore } from "@/store/appStore"
import { apiRequest } from "@/services/api"
import { Camera, Mail, Shield, User as UserIcon, Trash2, Loader2, Lock, Eye, EyeOff } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { API_BASE } from "@/config/endpoints"

export default function PersonalSettings() {
  const { user, setUser } = useAppStore()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)

  // Change password form
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [showPwCurrent, setShowPwCurrent] = useState(false)
  const [showPwNew, setShowPwNew] = useState(false)
  const [showPwConfirm, setShowPwConfirm] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Check if user is logged in
  useEffect(() => {
    if (!localStorage.getItem('auth_token')) {
      setMessage({ type: 'error', text: 'Session expired. Please log in again.' })
      setTimeout(() => navigate('/login'), 2000)
    }
  }, [])

  // Load existing avatar when user data is available
  useEffect(() => {
    if (!user?.avatar_url) return
    const url = user.avatar_url.startsWith('http') ? user.avatar_url : `${API_BASE}${user.avatar_url}`
    setAvatarPreview(url)
  }, [user?.avatar_url])

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please select an image file.' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Image must be under 5 MB.' })
      return
    }

    // Instant preview
    const reader = new FileReader()
    reader.onloadend = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)

    // Upload
    setAvatarLoading(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/users/me/avatar/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Upload failed')
      }
      const data = await response.json()
      const avatarUrl = data.avatar_url ? `${API_BASE}${data.avatar_url}` : null
      setUser({ ...user!, avatar_url: avatarUrl })
      setAvatarPreview(avatarUrl)
      setMessage({ type: 'success', text: 'Avatar updated.' })
    } catch (error: any) {
      // Revert preview
      const prev = user?.avatar_url
        ? (user.avatar_url.startsWith('http') ? user.avatar_url : `${API_BASE}${user.avatar_url}`)
        : null
      setAvatarPreview(prev)
      setMessage({ type: 'error', text: error.message || 'Failed to upload avatar.' })
    } finally {
      setAvatarLoading(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (!user) return
    setAvatarLoading(true)
    setMessage(null)
    try {
      await apiRequest<{ avatar_url: string | null }>("/users/me/avatar", { method: "DELETE" })
      setUser({ ...user, avatar_url: null })
      setAvatarPreview(null)
      setMessage({ type: 'success', text: 'Avatar removed.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to remove avatar.' })
    } finally {
      setAvatarLoading(false)
    }
  }

  const roleLabel = (() => {
    const r = String(user?.role || '').toLowerCase()
    if (r === 'system_manager') return 'System Manager'
    if (r === 'owner') return 'Owner'
    if (r === 'manager') return 'Manager'
    return 'Agent'
  })()
  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwMessage(null)
    if (pwNew !== pwConfirm) {
      setPwMessage({ type: 'error', text: 'New passwords do not match.' })
      return
    }
    if (pwNew.length < 6) {
      setPwMessage({ type: 'error', text: 'New password must be at least 6 characters.' })
      return
    }
    setPwSaving(true)
    try {
      await apiRequest('/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
      })
      setPwMessage({ type: 'success', text: 'Password changed successfully.' })
      setPwCurrent('')
      setPwNew('')
      setPwConfirm('')
      setShowPwCurrent(false)
      setShowPwNew(false)
      setShowPwConfirm(false)
    } catch (err: any) {
      setPwMessage({ type: 'error', text: err?.message || 'Failed to change password.' })
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center border-b dark:border-gray-700 px-6 flex-shrink-0">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Profile</h1>
      </div>

      <div className="flex-1 overflow-auto py-8">
        <div className="max-w-xl w-full mx-auto px-6 space-y-8">
          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
              {message.text}
            </div>
          )}

          {/* ─── Avatar + Identity ─── */}
          <div className="flex flex-col items-center text-center">
            {/* Clickable avatar */}
            <div className="relative group mb-4">
              <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-gray-100 dark:ring-gray-700">
                {avatarPreview ? (
                  <img src={avatarPreview} alt={user?.name || 'Avatar'} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{initials}</span>
                  </div>
                )}
              </div>
              {/* Hover overlay */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarLoading}
                className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all cursor-pointer"
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
                onChange={handleAvatarChange}
                className="sr-only"
              />
              {/* Remove button */}
              {avatarPreview && !avatarLoading && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center shadow-sm hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors group/del"
                  title="Remove avatar"
                >
                  <Trash2 className="h-3.5 w-3.5 text-gray-400 group-hover/del:text-red-500 transition-colors" />
                </button>
              )}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{user?.name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{user?.email}</p>
            <span className="mt-2 inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              {roleLabel}
            </span>
          </div>

          {/* ─── Account Details ─── */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Account Details</h3>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800/50">
              <div className="flex items-center gap-3 px-4 py-3">
                <UserIcon className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <span className="text-sm text-gray-500 dark:text-gray-400 w-16">Name</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{user?.name}</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Mail className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <span className="text-sm text-gray-500 dark:text-gray-400 w-16">Email</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{user?.email}</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Shield className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <span className="text-sm text-gray-500 dark:text-gray-400 w-16">Role</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{roleLabel}</span>
              </div>
            </div>
          </div>

          {/* ─── Change Password ─── */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Change Password</h3>
            <form onSubmit={handleChangePassword} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4 space-y-4">
              {pwMessage && (
                <div className={`p-3 rounded-lg text-sm ${pwMessage.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                  }`}>
                  {pwMessage.text}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  <Lock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showPwCurrent ? 'text' : 'password'}
                    value={pwCurrent}
                    onChange={e => setPwCurrent(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-gray-800 dark:border-gray-700"
                  />
                  <button type="button" onClick={() => setShowPwCurrent(v => !v)} tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    {showPwCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPwNew ? 'text' : 'password'}
                    value={pwNew}
                    onChange={e => setPwNew(e.target.value)}
                    placeholder="Min. 6 characters"
                    autoComplete="new-password"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-gray-800 dark:border-gray-700"
                  />
                  <button type="button" onClick={() => setShowPwNew(v => !v)} tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    {showPwNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showPwConfirm ? 'text' : 'password'}
                    value={pwConfirm}
                    onChange={e => setPwConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-gray-800 dark:border-gray-700"
                  />
                  <button type="button" onClick={() => setShowPwConfirm(v => !v)} tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    {showPwConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {pwNew && pwConfirm && pwNew !== pwConfirm && (
                  <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {pwSaving ? 'Saving…' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
