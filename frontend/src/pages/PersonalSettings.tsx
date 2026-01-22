import { useState, useEffect } from "react"
import { useAppStore } from "@/store/appStore"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiRequest } from "@/services/api"
import { User as UserIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { getNotificationPermission, getVapidPublicKey, isPushSupported, requestPermissionAndSubscribe } from "@/services/push"
import { API_BASE } from "@/config/endpoints"

export default function PersonalSettings() {
  const { user, setUser } = useAppStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushPermission, setPushPermission] = useState<ReturnType<typeof getNotificationPermission>>(
    typeof window !== 'undefined' ? getNotificationPermission() : 'unsupported'
  )
  const [vapidPublicKeyPresent, setVapidPublicKeyPresent] = useState<boolean | null>(null)

  // Check if user is logged in
  useEffect(() => {
    if (!localStorage.getItem('auth_token')) {
      setMessage({ type: 'error', text: 'Session expired. Please log in again.' })
      setTimeout(() => navigate('/login'), 2000)
    }
  }, [])

  // Load existing avatar when user data is available
  useEffect(() => {
    if (user?.avatar_url) {
      const fullAvatarUrl = user.avatar_url.startsWith('http')
        ? user.avatar_url
        : `${API_BASE}${user.avatar_url}`
      setAvatarPreview(fullAvatarUrl)
    }
  }, [user])

  // Push status (best-effort; public key is safe to fetch unauthenticated)
  useEffect(() => {
    let cancelled = false
      ; (async () => {
        try {
          const key = await getVapidPublicKey()
          if (!cancelled) setVapidPublicKeyPresent(Boolean(key))
        } catch {
          if (!cancelled) setVapidPublicKeyPresent(false)
        }
      })()
    return () => {
      cancelled = true
    }
  }, [])


  const handleEnablePush = async () => {
    setPushLoading(true)
    try {
      const perm = await requestPermissionAndSubscribe()
      setPushPermission(perm)
      if (perm === 'granted') {
        setMessage({ type: 'success', text: 'Browser notifications enabled.' })
      } else if (perm === 'denied') {
        setMessage({ type: 'error', text: 'Notifications were blocked in the browser.' })
      } else {
        setMessage({ type: 'error', text: 'Notifications permission was not granted.' })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to enable notifications' })
    } finally {
      setPushLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setMessage({
        type: 'error',
        text: 'Please select an image file'
      })
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setMessage({
        type: 'error',
        text: 'Image size must be less than 5MB'
      })
      return
    }

    setSelectedFile(file)

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleToggleAvailability = async () => {
    if (!user) return

    setLoading(true)
    setMessage(null)

    try {
      const response = await apiRequest<{ is_available: boolean }>("/users/me/availability", {
        method: "POST",
        body: JSON.stringify({ is_available: !user.is_available }),
      })

      setUser({ ...user, is_available: response.is_available })
      setMessage({
        type: 'success',
        text: `You are now ${response.is_available ? 'available' : 'unavailable'} for new chats`
      })
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to update availability'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateAvatar = async () => {
    if (!user) return
    if (!selectedFile) {
      setMessage({ type: 'error', text: 'Please select an image' })
      return
    }

    setAvatarLoading(true)
    setMessage(null)

    try {
      // Create FormData for file upload
      const formData = new FormData()
      formData.append('file', selectedFile)

      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${API_BASE}/users/me/avatar/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to upload avatar')
      }
      const data = await response.json()
      const avatarUrl = data.avatar_url ? `${API_BASE}${data.avatar_url}` : null

      setUser({ ...user, avatar_url: avatarUrl })
      setAvatarPreview(avatarUrl)
      setSelectedFile(null)
      setMessage({
        type: 'success',
        text: 'Avatar updated successfully'
      })
    } catch (error: any) {
      // Check if it's an auth error
      if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        setMessage({
          type: 'error',
          text: 'Session expired. Please log in again.'
        })
        setTimeout(() => navigate('/login'), 2000)
      } else {
        setMessage({
          type: 'error',
          text: error.message || 'Failed to update avatar'
        })
      }
    } finally {
      setAvatarLoading(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (!user) return

    setAvatarLoading(true)
    setMessage(null)

    try {
      const response = await apiRequest<{ avatar_url: string | null }>("/users/me/avatar", {
        method: "DELETE"
      })

      setUser({ ...user, avatar_url: null })
      setAvatarPreview(null)
      setSelectedFile(null)
      setMessage({
        type: 'success',
        text: 'Avatar removed successfully'
      })
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to remove avatar'
      })
    } finally {
      setAvatarLoading(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Personal Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">Manage your profile information</p>

        {message && (
          <div className={`mb-6 p-4 rounded-md ${message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}>
            {message.text}
          </div>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Your account details and avatar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Profile Avatar
              </label>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt={user?.name || 'Avatar'}
                      className="w-20 h-20 rounded-full object-cover border-2 border-gray-200 dark:border-gray-700"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                      <UserIcon className="w-10 h-10 text-gray-400 dark:text-gray-500" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Upload an image from your device (JPG, PNG, GIF - Max 5MB)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleUpdateAvatar}
                      disabled={avatarLoading || !selectedFile}
                      size="sm"
                      variant="outline"
                    >
                      {avatarLoading ? 'Updating...' : 'Update Avatar'}
                    </Button>
                    {avatarPreview && (
                      <Button
                        onClick={handleRemoveAvatar}
                        disabled={avatarLoading}
                        size="sm"
                        variant="destructive"
                      >
                        Remove Avatar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t dark:border-gray-700 pt-4" />

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
              <p className="mt-1 text-gray-900 dark:text-white">{user?.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
              <p className="mt-1 text-gray-900 dark:text-white">{user?.email}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
              <p className="mt-1 text-gray-900 dark:text-white capitalize">
                {user?.role === 'system_manager' ? 'System Manager' : user?.role === 'manager' ? 'Manager' : 'Agent'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Browser Notifications</CardTitle>
            <CardDescription>Enable push notifications for new chats while you are away</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Permission: <span className="font-medium">{String(pushPermission)}</span>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Push supported: <span className="font-medium">{isPushSupported() ? 'yes' : 'no'}</span>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Server VAPID configured: <span className="font-medium">{vapidPublicKeyPresent === null ? 'checking…' : vapidPublicKeyPresent ? 'yes' : 'no'}</span>
            </div>
            {!vapidPublicKeyPresent && (
              <div className="text-xs text-red-600 dark:text-red-400">
                Push is disabled on the backend (missing VAPID keys). Set VAPID env vars and restart the backend.
              </div>
            )}
            <Button
              onClick={handleEnablePush}
              disabled={pushLoading || !isPushSupported() || vapidPublicKeyPresent === false}
              variant="outline"
            >
              {pushLoading ? 'Enabling…' : 'Enable Notifications'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
