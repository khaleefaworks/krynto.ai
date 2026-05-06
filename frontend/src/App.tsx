import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DocsLayout from './pages/DocsLayout'
import DocsPage from './pages/DocsPage'
import { useAppStore } from './store/appStore'
import { useEffect, useState, useRef } from 'react'
import { getCurrentUser } from './services/auth'
import { isAdmin, isSuperAdmin, isOrgOwner } from './lib/roles'
import { fetchActiveChats } from './services/chats'
import OnboardingPage from './pages/OnboardingPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SignupPage from './pages/SignupPage'
import DashboardLayout from './pages/DashboardLayout'
import ConversationsView from './pages/ConversationsView'
import WebsiteManagement from './pages/WebsiteManagement'
import WebsiteDetail from './pages/WebsiteDetail'
import WebsitesList from './pages/WebsitesList'
import AgentsList from './pages/AgentsList'
import ConversationHistory from './pages/ConversationHistory'
import ClosedChatView from './pages/ClosedChatView'
import Settings from './pages/Settings'
import Customers from './pages/Customers'
import CustomersVisitors from './pages/CustomersVisitors'
import CustomersContacts from './pages/CustomersContacts'
import PersonalSettings from './pages/PersonalSettings'
import PersonalShortcutsSettings from './pages/PersonalShortcutsSettings'
import NotificationSettings from './pages/NotificationSettings'
import Teams from './pages/Teams'
import Analytics from './pages/Analytics'
import OrgSettings from './pages/OrgSettings'
import SuperAdminLayout from './pages/SuperAdminLayout'
import SuperAdminOrgs from './pages/SuperAdminOrgs'
import SuperAdminOrgDetail from './pages/SuperAdminOrgDetail'
import SuperAdminStats from './pages/SuperAdminStats'
import Logo from './components/Logo'
import { connectAgentSocket, addMessageHandler, disconnectAgentSocket } from './services/agentSocket'
import { ensurePushSubscription, isPushSupported } from './services/push'
import NotificationPermissionPrompt from './components/NotificationPermissionPrompt'
import { installNotificationSoundArm, playMessageNotificationSound, playNewVisitorNotificationSound } from './lib/notificationSound'
import { fetchNotificationPreferences, syncPrefsToLocalStorage } from './services/notificationPrefs'
import { API_BASE } from './config/endpoints'

const _lastToastByKey = new Map<string, number>()

// Global sound gate: any notification sound (chat or message) is blocked for this window.
// Prevents rapid-fire stacking when many events arrive at once.
let _lastAnySoundAt = 0
const _SOUND_MIN_INTERVAL_MS = 1500
// Cross-tab dedup key: any tab that plays a sound writes this key to localStorage
// so other tabs skip their own playback within the same window.
const _SOUND_CROSS_TAB_KEY = 'ai_chatassist_last_sound_at'

function _shouldPlaySound(): boolean {
  const now = Date.now()
  // In-process gate
  if (now - _lastAnySoundAt < _SOUND_MIN_INTERVAL_MS) return false
  // Cross-tab gate: check if another tab already played recently
  try {
    const crossTabTs = Number(localStorage.getItem(_SOUND_CROSS_TAB_KEY) || 0)
    if (now - crossTabTs < _SOUND_MIN_INTERVAL_MS) return false
  } catch { /* ignore */ }
  _lastAnySoundAt = now
  try { localStorage.setItem(_SOUND_CROSS_TAB_KEY, String(now)) } catch { /* ignore */ }
  return true
}

function _shouldToast(key: string, minIntervalMs: number): boolean {
  const now = Date.now()
  const prev = _lastToastByKey.get(key) || 0
  if (now - prev < minIntervalMs) return false
  _lastToastByKey.set(key, now)
  return true
}

// Race-fix: visitor_message often arrives a few ms before new_chat for the same
// first message. We delay the message sound 200 ms so a near-simultaneous
// new_chat event can cancel it and play the correct "New chat" sound instead.
// The existing 1500 ms gate handles the reverse order (new_chat first).
const _pendingMsgSoundTimers = new Map<number, ReturnType<typeof setTimeout>>()

function App() {
  const {
    token,
    user,
    setToken,
    setUser,
    setOrganization,
    setUnreadChatsCount,
    bumpChatEventsVersion,
  } = useAppStore()
  const [initializing, setInitializing] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isSuper = isSuperAdmin(user)
  const authedHome = isSuper ? '/superadmin/organizations' : '/dashboard/chats'

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

        // Only play sound when the tab is hidden. Visible tabs handle sound via the
        // WS event handler. In hidden tabs, WS event audio is blocked by autoplay
        // policy, so the SW postMessage is the reliable trigger for sound.
        if (!document.hidden) return

        const title = String(data?.title || '')
        try {
          // Match the sound to the push type: new-chat vs regular message.
          if (title.toLowerCase().startsWith('new chat')) {
            playNewVisitorNotificationSound()
          } else {
            playMessageNotificationSound()
          }
        } catch { }
      } catch {
        // ignore
      }
    }

    sw.addEventListener('message', handler)
    return () => {
      try { sw.removeEventListener('message', handler) } catch { }
    }
  }, [])

  // Single initialization effect: check setup status, then restore session.
  // Merging these three concerns prevents the race where the stale-token-clear
  // fires right after onboarding sets a fresh token (needsSetup was still true).
  useEffect(() => {
    const initialize = async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/setup/status`)
        const data = await response.json()
        const setupNeeded: boolean = !!data.needs_setup
        setNeedsSetup(setupNeeded)

        if (setupNeeded) {
          // Backend not yet initialized — clear any stale token from a previous session.
          localStorage.removeItem('auth_token')
          setToken(null)
          setUser(null)
          setOrganization(null)
        } else {
          // System initialized — try to restore session from localStorage.
          const storedToken = localStorage.getItem('auth_token')
          if (storedToken) {
            setToken(storedToken)
            try {
              const userData = await getCurrentUser()
              setUser(userData)
              // Sync notification sound preferences from DB → localStorage so
              // sounds always reflect the user's saved settings on any device.
              fetchNotificationPreferences().then(syncPrefsToLocalStorage).catch(() => { })
              // Populate org state for non-super-admin users.
              if (userData.role !== 'system_manager' && userData.organization_id) {
                try {
                  const orgRes = await fetch(`${API_BASE}/organization`, {
                    headers: { Authorization: `Bearer ${storedToken}` },
                  })
                  if (orgRes.ok) setOrganization(await orgRes.json())
                } catch { /* non-critical */ }
              }
            } catch {
              // Token expired or invalid.
              localStorage.removeItem('auth_token')
              setToken(null)
            }
          }
        }
      } catch {
        // Server unreachable — try restoring session anyway.
        const storedToken = localStorage.getItem('auth_token')
        if (storedToken) {
          setToken(storedToken)
          try {
            const userData = await getCurrentUser()
            setUser(userData)
          } catch {
            localStorage.removeItem('auth_token')
            setToken(null)
          }
        }
      }

      setInitializing(false)
    }

    initialize()
  }, [])

  // Global notification system - runs when user is authenticated
  useEffect(() => {
    if (!user?.id || !token) return

    // Super-admin doesn't use the agent socket or chat dashboard.
    if (isSuperAdmin(user)) return

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
          // Backend always sends a web push (handled by the SW push event) — avoid
          // a duplicate OS notification from the page when push is supported.
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
              try { window.focus() } catch { }
              try { window.location.assign(url) } catch { }
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


        if (data.type === 'new_chat') {
          // Cancel any pending visitor_message sound for this conversation —
          // new_chat takes priority and plays the "New chat" sound instead.
          // The 1500 ms gate handles the reverse order (new_chat arrives first).
          if (conversationId) {
            const pending = _pendingMsgSoundTimers.get(conversationId)
            if (pending !== undefined) {
              clearTimeout(pending)
              _pendingMsgSoundTimers.delete(conversationId)
            }
          }

          if (_shouldPlaySound()) {
            try { playNewVisitorNotificationSound() } catch { }
          }
          const websiteName = String((data as any)?.website_name || '').trim()
          const lastMessage = String((data as any)?.last_message || '').trim()
          const body = lastMessage ? lastMessage.slice(0, 120) : undefined

          const sessionId = String((data as any)?.session_id || '').trim()
          const url = sessionId ? `/dashboard/chats/${encodeURIComponent(sessionId)}` : '/dashboard/chats'

          maybeBrowserNotify({
            title: websiteName ? `New chat — ${websiteName}` : 'New chat',
            body,
            url,
            tag: conversationId ? `new_chat:${conversationId}` : 'new_chat',
          })

          if (_shouldToast(`new_chat:${conversationId || 'na'}`, 3000)) {
            void 0  // in-app toasts removed; desktop push + sounds handle notifications
          }
        } else if (data.type === 'visitor_message') {
          // Delay 200 ms: if a new_chat event arrives for the same conversation
          // within that window it will cancel this timer and play the correct
          // "New chat" sound. For all subsequent messages the timer simply fires
          // and plays the message sound normally.
          // If a timer is already pending for this conversation (rapid messages),
          // do NOT skip — cancel the old one and start a fresh 200 ms window.
          if (conversationId) {
            const existing = _pendingMsgSoundTimers.get(conversationId)
            if (existing !== undefined) clearTimeout(existing)
            const timer = setTimeout(() => {
              _pendingMsgSoundTimers.delete(conversationId)
              if (_shouldPlaySound()) {
                try { playMessageNotificationSound() } catch { }
              }
            }, 200)
            _pendingMsgSoundTimers.set(conversationId, timer)
          } else {
            // No conversation id — play immediately (fallback, should be rare).
            if (_shouldPlaySound()) {
              try { playMessageNotificationSound() } catch { }
            }
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
          const unreadChats = chats.filter((c: any) => c.status === 'open' && (c.unread_count ?? 0) > 0)
          setUnreadChatsCount(unreadChats.length)
        } catch (error) {
          console.error('Failed to update chat count:', error)
        }
      }
    })

    // Polling fallback - update count every 30 seconds
    const updateChatCount = async () => {
      try {
        const chats = await fetchActiveChats()
        const unreadChats = chats.filter((c: any) => c.status === 'open' && (c.unread_count ?? 0) > 0)
        setUnreadChatsCount(unreadChats.length)
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

  return (
    <BrowserRouter>
      {token ? <NotificationPermissionPrompt /> : null}
      <Routes>
        {/* System bootstrap — shown when backend is not yet initialized */}
        {needsSetup && !token ? (
          <>
            <Route path="/setup" element={<OnboardingPage />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </>
        ) : (
          <>
            {/* Login route - redirect to dashboard if already authenticated */}
            <Route
              path="/login"
              element={token ? <Navigate to={authedHome} replace /> : <LoginPage />}
            />
            {/* Public auth routes */}
            <Route
              path="/signup"
              element={token ? <Navigate to={authedHome} replace /> : <SignupPage />}
            />
            <Route
              path="/forgot-password"
              element={token ? <Navigate to={authedHome} replace /> : <ForgotPasswordPage />}
            />
            <Route
              path="/reset-password"
              element={token ? <Navigate to={authedHome} replace /> : <ResetPasswordPage />}
            />

            {/* Public docs portal — no auth required */}
            <Route path="/docs" element={<DocsLayout />}>
              <Route path="*" element={<DocsPage />} />
              <Route index element={<DocsPage />} />
            </Route>

            {/* Protected routes - require authentication */}
            {token ? (
              <>
                {/* Super-admin portal — SYSTEM_MANAGER only */}
                <Route
                  path="/superadmin"
                  element={isSuper ? <SuperAdminLayout /> : <Navigate to="/dashboard/chats" replace />}
                >
                  <Route path="organizations" element={<SuperAdminOrgs />} />
                  <Route path="organizations/:id" element={<SuperAdminOrgDetail />} />
                  <Route path="stats" element={<SuperAdminStats />} />
                  <Route index element={<Navigate to="/superadmin/organizations" replace />} />
                </Route>
                <Route
                  path="/dashboard"
                  element={!isSuper ? <DashboardLayout /> : <Navigate to="/superadmin/organizations" replace />}
                >
                  {/* Chats - Unified 3-column view */}
                  <Route path="chats" element={<ConversationsView />} />
                  <Route path="chats/conversation/:conversationId" element={<ConversationsView />} />
                  <Route path="chats/:chatId" element={<ConversationsView />} />
                  <Route path="history" element={<ConversationHistory />} />
                  <Route path="history/:conversationId" element={<ClosedChatView />} />

                  {/* Customers */}
                  <Route path="customers" element={<Customers />}>
                    <Route path="visitors" element={<CustomersVisitors />} />
                    <Route path="contacts" element={<CustomersContacts />} />
                    <Route index element={<Navigate to="/dashboard/customers/visitors" replace />} />
                  </Route>

                  {/* Settings - All users */}
                  <Route path="settings" element={<Settings />}>
                    {/* Organization settings - OWNER only */}
                    <Route
                      path="organization"
                      element={isOrgOwner(user) ? <OrgSettings /> : <Navigate to="/dashboard/chats" replace />}
                    />
                    {/* Websites management - Admin only */}
                    <Route
                      path="websites"
                      element={isAdmin(user) ? <WebsitesList /> : <Navigate to="/dashboard/chats" replace />}
                    />
                    <Route
                      path="websites/new"
                      element={<Navigate to="/dashboard/settings/websites" replace />}
                    />
                    <Route
                      path="websites/:id"
                      element={isAdmin(user) ? <WebsiteDetail /> : <Navigate to="/dashboard/chats" replace />}
                    />

                    {/* Users management - Admin only */}
                    <Route
                      path="users"
                      element={isAdmin(user) ? <AgentsList /> : <Navigate to="/dashboard/chats" replace />}
                    />
                    {/* Legacy routes – detail page removed, redirect to list */}
                    <Route path="users/:id" element={<Navigate to="/dashboard/settings/users" replace />} />
                    <Route path="agents" element={<Navigate to="/dashboard/settings/users" replace />} />
                    <Route path="agents/:id" element={<Navigate to="/dashboard/settings/users" replace />} />

                    {/* Tags route removed – tags are now per-website inside WebsiteDetail */}

                    {/* Personal settings - All users */}
                    <Route path="personal" element={<PersonalSettings />} />
                    <Route path="personal/shortcuts" element={<PersonalShortcutsSettings />} />
                    <Route path="personal/notifications" element={<NotificationSettings />} />
                    <Route index element={
                      <div className="flex-1 flex items-center justify-center h-full">
                        <div className="text-center max-w-md px-8">
                          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                            <Logo size={50} dotColor={user?.is_available ? '#22c55e' : '#ef4444'} />
                          </div>
                          <p className="text-base text-gray-500 dark:text-gray-400">
                            Select a section from the sidebar.
                          </p>
                        </div>
                      </div>
                    } />
                  </Route>

                  {/* Teams - All users (placeholder) */}
                  <Route path="teams" element={<Teams />} />

                  {/* Analytics - Admins & Managers only */}
                  <Route path="analytics" element={isAdmin(user) ? <Analytics /> : <Navigate to="/dashboard/chats" replace />} />

                  {/* Legacy routes - kept for backwards compatibility */}
                  <Route path="websites" element={<WebsiteManagement />} />

                  {/* Default route */}
                  <Route index element={<Navigate to="/dashboard/chats" replace />} />
                </Route>
                <Route
                  path="/"
                  element={<Navigate to={authedHome} replace />}
                />
                {/* Catch-all: redirect any unknown route to the main dashboard */}
                <Route path="*" element={<Navigate to={authedHome} replace />} />
              </>
            ) : (
              // Not authenticated - redirect everything to login
              <Route path="*" element={<Navigate to="/login" replace />} />
            )}
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}

export default App
