import React, { useState, useEffect } from 'react'
import { Bell, X, Info } from 'lucide-react'
import { Button } from './ui/button'
import { requestPermissionAndSubscribe, getNotificationPermission } from '@/services/push'
import { installNotificationSoundArm, ensureHardwareLabelsUnlocked } from '@/lib/notificationSound'

export default function NotificationPermissionPrompt() {
  const [show, setShow] = useState(false)
  const [permission, setPermission] = useState<string>(getNotificationPermission())

  useEffect(() => {
    // Check permission status on mount
    const checkPermission = () => {
      const currentPermission = Notification.permission
      setPermission(currentPermission)
      
      // If permission is 'default', we want to show our custom prompt
      if (currentPermission === 'default') {
        setShow(true)
      } else {
        setShow(false)
      }
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      checkPermission()
    }
  }, [])

  const handleContinue = async () => {
    // Hide immediately to keep UI responsive
    setShow(false)

    // Also try to arm sound since this is a user gesture
    installNotificationSoundArm()
    // Trigger hardware labels unlocking (for audio routing)
    ensureHardwareLabelsUnlocked()
    
    try {
      const result = await requestPermissionAndSubscribe()
      setPermission(result)
    } catch (error) {
      console.error('Error requesting notification permission:', error)
    }
  }

  const handleDismiss = () => {
    setShow(false)
    // We could store in localStorage if we want to skip for a while, 
    // but user asked for "whenever user opens the app"
  }

  if (!show) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-md animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <Bell className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Enable desktop notifications
              </h3>
            </div>
            <button 
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="mt-3 ml-13">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Don't miss any customer messages. Enable notifications to stay updated in real-time.
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <Button 
              onClick={handleContinue}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
