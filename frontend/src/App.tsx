import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import { useEffect, useState } from 'react'
import { getCurrentUser } from './services/auth'
import { isAdmin } from './lib/roles'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './pages/DashboardLayout'
import ActiveChats from './pages/ActiveChats'
import ChatView from './pages/ChatView'
import WebsiteManagement from './pages/WebsiteManagement'
import KnowledgeManagement from './pages/KnowledgeManagement'
import ConversationHistory from './pages/ConversationHistory'
import ClosedChatView from './pages/ClosedChatView'
import Settings from './pages/Settings'
import WebsitesSettings from './pages/WebsitesSettings'
import PersonalSettings from './pages/PersonalSettings'
import Analytics from './pages/Analytics'

function App() {
  const { token, user, setToken, setUser } = useAppStore()
  const [initializing, setInitializing] = useState(true)

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
              {/* Chats - All users */}
              <Route path="chats" element={<ActiveChats />} />
              <Route path="chats/:conversationId" element={<ChatView />} />
              <Route path="history" element={<ConversationHistory />} />
              <Route path="history/:conversationId" element={<ClosedChatView />} />
              
              {/* Settings - All users */}
              <Route path="settings" element={<Settings />} />
              <Route 
                path="settings/websites" 
                element={isAdmin(user) ? <WebsitesSettings /> : <Navigate to="/dashboard/chats" replace />} 
              />
              <Route path="settings/personal" element={<PersonalSettings />} />
              
              {/* Analytics - All users (placeholder) */}
              <Route path="analytics" element={<Analytics />} />
              
              {/* Legacy routes - kept for backwards compatibility */}
              <Route path="websites" element={<WebsiteManagement />} />
              <Route path="knowledge" element={<KnowledgeManagement />} />
              
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
