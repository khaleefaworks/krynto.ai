import { useState, useEffect } from "react"
import { useAppStore } from "@/store/appStore"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiRequest } from "@/services/api"
import { User as UserIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"

export default function PersonalSettings() {
  const { user, setUser } = useAppStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)

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
        : `http://localhost:8000${user.avatar_url}`
      setAvatarPreview(fullAvatarUrl)
    }
  }, [user])

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

      // Upload file
      const token = localStorage.getItem('auth_token')
      const response = await fetch('http://localhost:8000/users/me/avatar/upload', {
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
      const avatarUrl = data.avatar_url ? `http://localhost:8000${data.avatar_url}` : null
      
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
        <p className="text-gray-600 dark:text-gray-400 mb-8">Manage your profile and availability</p>

        {message && (
          <div className={`mb-6 p-4 rounded-md ${
            message.type === 'success' 
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

        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            <CardDescription>
              Control whether you can receive new chat assignments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-medium">
                  Current Status: {' '}
                  <span className={user?.is_available ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}>
                    {user?.is_available ? 'Available' : 'Unavailable'}
                  </span>
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {user?.is_available 
                    ? 'You can receive new chat assignments'
                    : 'You will not receive new chat assignments'}
                </p>
              </div>
              <Button
                onClick={handleToggleAvailability}
                disabled={loading}
                variant={user?.is_available ? 'outline' : 'default'}
              >
                {loading ? 'Updating...' : user?.is_available ? 'Set Unavailable' : 'Set Available'}
              </Button>
            </div>

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Note:</strong> To receive chats, you must be both <strong>available</strong> (this toggle) 
                and <strong>connected</strong> (logged in with active WebSocket).
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
