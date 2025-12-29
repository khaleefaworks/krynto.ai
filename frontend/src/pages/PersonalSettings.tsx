import { useState } from "react"
import { useAppStore } from "@/store/appStore"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { apiRequest } from "@/services/api"

export default function PersonalSettings() {
  const { user, setUser } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleToggleAvailability = async () => {
    if (!user) return

    setLoading(true)
    setMessage(null)

    try {
      const response = await apiRequest<{ is_available: boolean }>("/users/me/availability", {
        method: "POST",
        body: JSON.stringify({ is_available: !user.is_available }),
      })

      // Update user in store
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

  return (
    <div className="flex h-screen">
      {/* Settings Sidebar (hidden, imported from Settings.tsx) */}
      
      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Personal Settings</h1>
          <p className="text-gray-600 mb-8">Manage your profile and availability</p>

          {message && (
            <div className={`mb-6 p-4 rounded-md ${
              message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {message.text}
            </div>
          )}

          {/* Profile Information */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Your account details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  {user?.role === 'full_access' ? 'Administrator' : 'Agent'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Availability Toggle */}
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
      </main>
    </div>
  )
}
