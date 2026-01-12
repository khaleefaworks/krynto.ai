import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

export default function ResetApplication() {
  const navigate = useNavigate()
  const { setToken, setUser } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  const handleReset = async () => {
    if (confirmText !== 'RESET') {
      setError('Please type RESET to confirm')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await apiRequest('/system/reset', {
        method: 'POST',
      })

      // Clear auth and redirect to login
      localStorage.removeItem('auth_token')
      setToken(null)
      setUser(null)

      // Show success message and redirect
      alert('Application reset successfully! You will be redirected to login.')
      navigate('/login')
    } catch (err: any) {
      setError(err.message || 'Failed to reset application')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8">
      <Button
        variant="ghost"
        onClick={() => navigate('/dashboard/chats')}
        className="gap-2 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Button>

      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Reset Application</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Restore the application to its initial state
        </p>

        {/* Warning Card */}
        <Card className="mb-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-800 dark:text-red-300">
              <AlertTriangle className="w-5 h-5" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-red-700 dark:text-red-400">
              This action cannot be undone!
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-red-800 dark:text-red-300 mb-4">
              Resetting the application will:
            </p>
            <ul className="list-disc list-inside space-y-2 text-red-800 dark:text-red-300 mb-6">
              <li>Delete all application data (users, websites, conversations, messages)</li>
              <li>Re-run database migrations</li>
              <li>Seed initial data (including the default administrator)</li>
            </ul>
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              You will be logged out after the reset and need to log in again with the default administrator credentials.
            </p>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {!showConfirm ? (
          <Card>
            <CardContent className="pt-6">
              <Button
                variant="destructive"
                onClick={() => setShowConfirm(true)}
                className="w-full gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Proceed with Reset
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Confirm Reset</CardTitle>
              <CardDescription>
                Type <strong>RESET</strong> to confirm this destructive action
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Confirmation Text
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type RESET"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  autoFocus
                />
              </div>

              <div className="flex gap-4">
                <Button
                  variant="destructive"
                  onClick={handleReset}
                  disabled={loading || confirmText !== 'RESET'}
                  className="flex-1 gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  {loading ? 'Resetting...' : 'Reset Application'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowConfirm(false)
                    setConfirmText('')
                    setError(null)
                  }}
                  disabled={loading}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>

              {loading && (
                <div className="text-center text-sm text-gray-600 dark:text-gray-400">
                  This may take up to 60 seconds...
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
