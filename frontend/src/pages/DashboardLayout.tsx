import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import { LogOut, MessageSquare, Settings, BarChart3, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import { isAdmin } from '@/lib/roles'

export default function DashboardLayout() {
  const { user, setUser, setToken } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    // Clear token from localStorage
    clearToken()
    
    // Clear store
    setUser(null)
    setToken(null)
    
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname.startsWith(path)

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-16 bg-white border-r flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center justify-center border-b">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">AC</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col py-4">
          <Link
            to="/dashboard/chats"
            className={`flex items-center justify-center py-3 hover:bg-gray-100 ${
              isActive('/dashboard/chats') ? 'bg-gray-100 border-r-2 border-black' : ''
            }`}
            title="Chats"
          >
            <MessageSquare className={`h-5 w-5 ${isActive('/dashboard/chats') ? 'text-black' : 'text-gray-600'}`} />
          </Link>

          <Link
            to="/dashboard/settings"
            className={`flex items-center justify-center py-3 hover:bg-gray-100 ${
              isActive('/dashboard/settings') ? 'bg-gray-100 border-r-2 border-black' : ''
            }`}
            title="Settings"
          >
            <Settings className={`h-5 w-5 ${isActive('/dashboard/settings') ? 'text-black' : 'text-gray-600'}`} />
          </Link>

          <Link
            to="/dashboard/analytics"
            className={`flex items-center justify-center py-3 hover:bg-gray-100 ${
              isActive('/dashboard/analytics') ? 'bg-gray-100 border-r-2 border-black' : ''
            }`}
            title="Analytics"
          >
            <BarChart3 className={`h-5 w-5 ${isActive('/dashboard/analytics') ? 'text-black' : 'text-gray-600'}`} />
          </Link>
        </nav>

        {/* Profile at bottom */}
        <div className="border-t">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center py-3 hover:bg-gray-100"
            title={`${user?.email} - Logout`}
          >
            <User className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
