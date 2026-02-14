import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import { useEffect, useState, useRef } from 'react'
import { getCurrentUser } from './services/auth'
import { isAdmin, isAdministrator } from './lib/roles'
import { fetchActiveChats } from './services/chats'
import OnboardingPage from './pages/OnboardingPage'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './pages/DashboardLayout'
import ConversationsView from './pages/ConversationsView'
import WebsiteManagement from './pages/WebsiteManagement'
import WebsiteDetail from './pages/WebsiteDetail'
import WebsitesList from './pages/WebsitesList'
import AgentsList from './pages/AgentsList'
import AgentDetail from './pages/AgentDetail'
import ConversationHistory from './pages/ConversationHistory'
import ClosedChatView from './pages/ClosedChatView'
import Settings from './pages/Settings'
import PersonalSettings from './pages/PersonalSettings'
import PersonalShortcutsSettings from './pages/PersonalShortcutsSettings'
import TagsSettings from './pages/TagsSettings'
import Analytics from './pages/Analytics'
import ResetApplication from './pages/ResetApplication'
import { connectAgentSocket, addMessageHandler, disconnectAgentSocket } from './services/agentSocket'
import { ensurePushSubscription, isPushSupported } from './services/push'
import NotificationToasts from './components/NotificationToasts'
import NotificationPermissionPrompt from './components/NotificationPermissionPrompt'
import { installNotificationSoundArm, playMessageNotificationSound, playNewVisitorNotificationSound } from './lib/notificationSound'
import { API_BASE } from './config/endpoints'

const _lastToastByKey = new Map<string, number>()

function _shouldToast(key: string, minIntervalMs: number): boolean {
  const now = Date.now()
  const prev = _lastToastByKey.get(key) || 0
  if (now - prev < minIntervalMs) return false
  _lastToastByKey.set(key, now)
  return true
}

function _shouldBeep(key: string, minIntervalMs: number): boolean {
  return _shouldToast(`beep:${key}`, minIntervalMs)
}

function App() {
  const {
    token,
    user,
    setToken,
    setUser,
    setUnreadChatsCount,
    bumpChatEventsVersion,
    pushNotification,
  } = useAppStore()
  const [initializing, setInitializing] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Arm notification audio on first user gesture (required by browsers).
  useEffect(() => {
    installNotificationSoundArm()
  }, [])

  // If a push arrives while the dashboard is already open, the service worker
  // forwards it via postMessage so we can play an in-app sound.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sw = navigator.serviceWorker
    if (!sw) return

    const handler = (event: MessageEvent) => {
      try {
        const data: any = event?.data || {}
        if (data?.type !== 'push') return

        // If the dashboard is open + realtime is connected, avoid double-beeping.
        // In that case the WebSocket event handler will produce the in-app beep.
        const isRealtimeConnected = Boolean((useAppStore as any).getState?.()?.isConnected)
        if (document.visibilityState === 'visible' && isRealtimeConnected) return

        if (_shouldBeep('sw_push', 1200)) {
          try { playMessageNotificationSound() } catch { }
        }

        const title = String(data?.title || 'Notification')
        void title
      } catch {
        // ignore
      }
    }

    sw.addEventListener('message', handler)
    return () => {
      try { sw.removeEventListener('message', handler) } catch { }
    }
  }, [pushNotification])

  // Check if system needs initial setup
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/setup/status`)
        const data = await response.json()
        setNeedsSetup(data.needs_setup)
      } catch (error) {
        console.error('Failed to check setup status:', error)
      }
    }

    checkSetup()
  }, [])

  // Restore auth from localStorage on mount
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('auth_token')
      if (storedToken && !token) {
        setToken(storedToken)
        try {
          // Fetch user details using the stored token
          const userData = await getCurrentUser()
          setUser(userData)
        } catch (error) {
          // Token invalid, clear it
          console.error('Invalid token, clearing:', error)
          localStorage.removeItem('auth_token')
          setToken(null)
        }
      }
      setInitializing(false)
    }

    initAuth()
  }, [])

  // Global notification system - runs when user is authenticated
  useEffect(() => {
    if (!user?.id || !token) return

    // Best-effort push subscription registration.
    // Do NOT auto-prompt permission here; browsers often require a user gesture.
    ensurePushSubscription().catch(() => { })

    // Single socket for both notifications + chat events.
    // We connect only to the global agent socket (website_id=0).
    try {
      connectAgentSocket(0, user.id)
    } catch (e) {
      console.error('Failed to connect agent socket:', e)
    }

    const removeHandler = addMessageHandler(async (data) => {
      console.log('🔔 Agent socket event:', data)

      const maybeBrowserNotify = (opts: { title: string; body?: string; url?: string; tag?: string }) => {
        try {
          if (typeof window === 'undefined') return
          if (!('Notification' in window)) return
          if (Notification.permission !== 'granted') return
          // Prevent duplicates: if push is supported, rely on SW push for OS notifications.
          if (isPushSupported()) return

          // Only show OS notifications when the tab isn't visible.
          if (!document.hidden) return

          const n = new Notification(String(opts.title || 'Notification'), {
            body: opts.body ? String(opts.body) : undefined,
            tag: opts.tag ? String(opts.tag) : undefined,
          })

          const url = opts.url ? String(opts.url) : ''
          if (url) {
            n.onclick = () => {
              try {
                window.focus()
              } catch {
                // ignore
              }
              try {
                window.location.assign(url)
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // Best-effort: never break realtime handling.
        }
      }

      // In-app notifications surface (minimal toast stack).
      // Throttle per-conversation to avoid flooding on rapid message bursts.
      try {
        const conversationId =
          typeof (data as any)?.conversation_id === 'number'
            ? (data as any).conversation_id
            : Number((data as any)?.conversation_id) || undefined

        const websiteId =
          typeof (data as any)?.website_id === 'number'
            ? (data as any).website_id
            : Number((data as any)?.website_id) || undefined

        if (data.type === 'new_chat') {
          if (_shouldBeep('new_chat', 1200)) {
            try { playNewVisitorNotificationSound() } catch { }
          }
          const websiteName = String((data as any)?.website_name || '').trim()
          const lastMessage = String((data as any)?.last_message || '').trim()
          const body = lastMessage ? lastMessage.slice(0, 120) : undefined

          const sessionId = String((data as any)?.session_id || '').trim()
          const url = sessionId ? `/dashboard/chats?sessionId=${encodeURIComponent(sessionId)}` : '/dashboard/chats'

          maybeBrowserNotify({
            title: websiteName ? `New chat — ${websiteName}` : 'New chat',
            body,
            url,
            tag: conversationId ? `new_chat:${conversationId}` : 'new_chat',
          })

          if (_shouldToast(`new_chat:${conversationId || 'na'}`, 3000)) {
            pushNotification({
              type: 'new_chat',
              title: websiteName ? `New chat — ${websiteName}` : 'New chat',
              body,
              conversationId,
              websiteId,
            })
          }
        } else if (data.type === 'visitor_message' || data.type === 'conversation_unread') {
          if (_shouldBeep(String(conversationId || 'activity'), 1200)) {
            try { playMessageNotificationSound() } catch { }
          }
          if (conversationId && _shouldToast(`activity:${conversationId}`, 8000)) {
            const dto = (data as any)?.message_obj
            const content =
              (dto && typeof dto === 'object' ? String((dto as any)?.content || '').trim() : '') ||
              String((data as any)?.message || '').trim()

            maybeBrowserNotify({
              title: 'New visitor activity',
              body: content ? content.slice(0, 120) : undefined,
              url: '/dashboard/chats',
              tag: `activity:${conversationId}`,
            })

            pushNotification({
              type: String(data.type),
              title: 'New visitor activity',
              body: content ? content.slice(0, 120) : undefined,
              conversationId,
              websiteId,
            })
          }
        }
      } catch {
        // Never break realtime handling because of toast UI.
      }

      if (
        data.type === 'new_chat' ||
        data.type === 'conversation_unread' ||
        data.type === 'conversation_assigned' ||
        data.type === 'conversation_closed' ||
        data.type === 'visitor_message' ||
        data.type === 'visitor_closed_chat' ||
        data.type === 'visitor_left_website' ||
        data.type === 'visitor_socket_connected'
      ) {
        bumpChatEventsVersion({
          type: data.type,
          conversation_id:
            typeof data.conversation_id === 'number'
              ? data.conversation_id
              : Number(data.conversation_id) || undefined,
          website_id:
            typeof data.website_id === 'number' ? data.website_id : Number(data.website_id) || undefined,
        })

        try {
          const chats = await fetchActiveChats()
          const openChats = chats.filter((c) => c.status === 'open')
          setUnreadChatsCount(openChats.length)
        } catch (error) {
          console.error('Failed to update chat count:', error)
        }
      }
    })

    // Polling fallback - update count every 30 seconds
    const updateChatCount = async () => {
      try {
        const chats = await fetchActiveChats()
        const openChats = chats.filter(c => c.status === 'open')
        setUnreadChatsCount(openChats.length)
      } catch (error) {
        console.error('Failed to update chat count:', error)
      }
    }

    // Initial count
    updateChatCount()

    // Poll every 30 seconds
    pollingIntervalRef.current = setInterval(updateChatCount, 30000)

    // Cleanup
    return () => {
      removeHandler()
      disconnectAgentSocket()
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [user?.id, token, setUnreadChatsCount, bumpChatEventsVersion])

  // Show loading while initializing
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  // Show onboarding if system needs setup
  if (needsSetup && !token) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<OnboardingPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <NotificationToasts />
      {token ? <NotificationPermissionPrompt /> : null}
      <Routes>
        {/* Login route - redirect to dashboard if already authenticated */}
        <Route
          path="/login"
          element={token ? <Navigate to="/dashboard/chats" replace /> : <LoginPage />}
        />

        {/* Protected routes - require authentication */}
        {token ? (
          <>
            <Route path="/dashboard" element={<DashboardLayout />}>
              {/* Chats - Unified 3-column view */}
              <Route path="chats" element={<ConversationsView />} />
              <Route path="chats/:sessionId" element={<ConversationsView />} />
              <Route path="history" element={<ConversationHistory />} />
              <Route path="history/:conversationId" element={<ClosedChatView />} />

              {/* Settings - All users */}
              <Route path="settings" element={<Settings />}>
                {/* Websites management - Admin only */}
                <Route
                  path="websites"
                  element={isAdmin(user) ? <WebsitesList /> : <Navigate to="/dashboard/chats" replace />}
                />
                <Route
                  path="websites/:id"
                  element={isAdmin(user) ? <WebsiteDetail /> : <Navigate to="/dashboard/chats" replace />}
                />

                {/* Agents management - Admin only */}
                <Route
                  path="users"
                  element={isAdmin(user) ? <AgentsList /> : <Navigate to="/dashboard/chats" replace />}
                />
                <Route
                  path="users/:id"
                  element={isAdmin(user) ? <AgentDetail /> : <Navigate to="/dashboard/chats" replace />}
                />

                {/* Legacy settings routes (agents -> users) */}
                <Route path="agents" element={<Navigate to="/dashboard/settings/users" replace />} />
                <Route path="agents/:id" element={<LegacySettingsAgentsRedirect />} />

                {/* Tags management - Admin only */}
                <Route
                  path="tags"
                  element={isAdmin(user) ? <TagsSettings /> : <Navigate to="/dashboard/chats" replace />}
                />

                {/* Personal settings - All users */}
                <Route path="personal" element={<PersonalSettings />} />
                <Route path="personal/shortcuts" element={<PersonalShortcutsSettings />} />
                <Route index element={
                  <div className="p-8">
                    <div className="max-w-4xl">
                      <div className="text-center text-gray-500 dark:text-gray-400 py-12">
                        Select a settings section from the sidebar
                      </div>
                    </div>
                  </div>
                } />
              </Route>

              {/* Analytics - All users (placeholder) */}
              <Route path="analytics" element={<Analytics />} />

              {/* Reset Application - Administrator only */}
              <Route
                path="reset"
                element={isAdministrator(user) ? <ResetApplication /> : <Navigate to="/dashboard/chats" replace />}
              />

              {/* Legacy routes - kept for backwards compatibility */}
              <Route path="websites" element={<WebsiteManagement />} />

              {/* Default route */}
              <Route index element={<Navigate to="/dashboard/chats" replace />} />
            </Route>
            <Route path="/" element={<Navigate to="/dashboard/chats" replace />} />
          </>
        ) : (
          // Not authenticated - redirect everything to login
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </BrowserRouter>
  )
}

function LegacySettingsAgentsRedirect() {
  const { id } = useParams<{ id?: string }>()
  const target = id ? `/dashboard/settings/users/${id}` : '/dashboard/settings/users'
  return <Navigate to={target} replace />
}

export default App
