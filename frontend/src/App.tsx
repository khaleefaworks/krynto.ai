import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import { useEffect, useState } from 'react'
import { getCurrentUser } from './services/auth'
import { isAdmin, isAdministrator } from './lib/roles'
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
  const { token, user, setToken, setUser } = useAppStore()
  const [initializing, setInitializing] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)

  // Check if system needs initial setup
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await fetch('http://localhost:8000/auth/setup/status')
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
              <Route path="chats/:conversationId" element={<ConversationsView />} />
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
