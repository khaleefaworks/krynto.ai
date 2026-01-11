const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"
const WS_BASE =
  import.meta.env.VITE_WS_BASE ||
  (API_BASE.startsWith("https://")
    ? "wss://" + API_BASE.slice("https://".length)
    : API_BASE.startsWith("http://")
      ? "ws://" + API_BASE.slice("http://".length)
      : API_BASE)
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import Analytics from './pages/Analytics'
import ResetApplication from './pages/ResetApplication'

function App() {
  const { token, user, setToken, setUser, setUnreadChatsCount, bumpChatEventsVersion } = useAppStore()
  const [initializing, setInitializing] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const notificationSocketRef = useRef<WebSocket | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

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

    let reconnectTimeout: NodeJS.Timeout | null = null

    const setupGlobalNotifications = () => {
      // WebSocket for real-time notifications (authenticated via query param)
      const wsUrl = `${WS_BASE}/ws/agent/0?token=${encodeURIComponent(token)}`
      console.log('🔔 Setting up global notifications (authenticated)...')

      const ws = new WebSocket(wsUrl)
      notificationSocketRef.current = ws

      ws.onopen = () => {
        console.log('✅ Global notifications connected')
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }
      }

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data)
        console.log('🔔 Global notification:', data)

        // Global event signal for chat list changes + unread updates.
        if (
          data.type === 'new_chat' ||
          data.type === 'conversation_unread' ||
          data.type === 'conversation_assigned' ||
          data.type === 'conversation_closed' ||
          data.type === 'visitor_message'
        ) {
          bumpChatEventsVersion({
            type: data.type,
            conversation_id: typeof data.conversation_id === 'number' ? data.conversation_id : Number(data.conversation_id) || undefined,
            website_id: typeof data.website_id === 'number' ? data.website_id : Number(data.website_id) || undefined,
          })
          console.log('📨 Chat update notification - updating count...')
          // Fetch updated chat list and count
          try {
            const chats = await fetchActiveChats()
            const openChats = chats.filter(c => c.status === 'open')
            setUnreadChatsCount(openChats.length)
            console.log(`📊 Updated unread count: ${openChats.length}`)
          } catch (error) {
            console.error('Failed to update chat count:', error)
          }
        }
      }

      ws.onerror = (error) => {
        console.error('❌ Global notification error:', error)
      }

      ws.onclose = (event) => {
        console.log('🔌 Global notifications closed')
        notificationSocketRef.current = null

        // Auto-reconnect after 5 seconds if not intentional
        if (event.code !== 1000 && user?.id) {
          console.log('🔄 Will reconnect in 5 seconds...')
          reconnectTimeout = setTimeout(() => {
            console.log('🔄 Reconnecting global notifications...')
            setupGlobalNotifications()
          }, 5000)
        }
      }
    }

    // Initial setup
    setupGlobalNotifications()

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
      if (notificationSocketRef.current) {
        notificationSocketRef.current.close()
        notificationSocketRef.current = null
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
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
                  path="agents"
                  element={isAdmin(user) ? <AgentsList /> : <Navigate to="/dashboard/chats" replace />}
                />
                <Route
                  path="agents/:id"
                  element={isAdmin(user) ? <AgentDetail /> : <Navigate to="/dashboard/chats" replace />}
                />

                {/* Personal settings - All users */}
                <Route path="personal" element={<PersonalSettings />} />
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

export default App
