import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import { LogOut, MessageSquare, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'

export default function DashboardLayout() {
  const { agent, setAgent, setToken } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    // Clear token from localStorage
    clearToken()
    
    // Clear store
    setAgent(null)
    setToken(null)
    
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname.startsWith(path)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">AI ChatAssist</h1>
              <p className="text-sm text-gray-500">Agent Dashboard</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-700">{agent?.email}</span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
          
          {/* Navigation */}
          <nav className="mt-4 flex gap-2">
            <Link to="/dashboard/chats">
              <Button 
                variant={isActive('/dashboard/chats') ? 'default' : 'ghost'}
                size="sm"
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Active Chats
              </Button>
            </Link>
            <Link to="/dashboard/websites">
              <Button 
                variant={isActive('/dashboard/websites') ? 'default' : 'ghost'}
                size="sm"
              >
                <Globe className="h-4 w-4 mr-2" />
                Websites
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
