import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './pages/DashboardLayout'
import ActiveChats from './pages/ActiveChats'
import ChatView from './pages/ChatView'

function App() {
  const token = useAppStore((state) => state.token)

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        {token ? (
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="chats" element={<ActiveChats />} />
            <Route path="chats/:conversationId" element={<ChatView />} />
            <Route index element={<Navigate to="/dashboard/chats" replace />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
        
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
