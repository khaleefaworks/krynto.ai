import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import { LogOut, MessageSquare, Settings, BarChart3, User, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import { isAdmin } from '@/lib/roles'
import { useState, useEffect } from 'react'

export default function DashboardLayout() {
  const { user, setUser, setToken } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode')
    return saved ? JSON.parse(saved) : false
  })

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode))
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

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
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="w-20 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col shadow-sm">
        {/* Logo */}
        <div className="h-20 flex items-center justify-center border-b border-gray-200 dark:border-gray-700">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
            <span className="text-white font-bold text-lg">AC</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col py-6 gap-2 px-2">
          <Link
            to="/dashboard/chats"
            className={`flex items-center justify-center py-3 rounded-lg transition-all ${
              isActive('/dashboard/chats') 
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="Chats"
          >
            <MessageSquare className="h-5 w-5" />
          </Link>

          <Link
            to="/dashboard/settings"
            className={`flex items-center justify-center py-3 rounded-lg transition-all ${
              isActive('/dashboard/settings') 
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>

          <Link
            to="/dashboard/analytics"
            className={`flex items-center justify-center py-3 rounded-lg transition-all ${
              isActive('/dashboard/analytics') 
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="Analytics"
          >
            <BarChart3 className="h-5 w-5" />
          </Link>
        </nav>

        {/* Bottom actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-2 space-y-2">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="w-full flex items-center justify-center py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
            title={darkMode ? 'Light mode' : 'Dark mode'}
          >
            {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all"
            title={`${user?.email} - Logout`}
          >
            <LogOut className="h-5 w-5" />
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
