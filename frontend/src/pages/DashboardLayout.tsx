import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import { LogOut, MessageSquare, Settings, BarChart3, User, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import { isAdmin } from '@/lib/roles'
import { useState, useEffect } from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { updateAvailability } from '@/services/auth'

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

  const handleAvailabilityToggle = async (checked: boolean) => {
    if (!user) return
    
    try {
      const response = await updateAvailability(checked)
      // Update user in store with new availability
      setUser({ ...user, is_available: response.is_available })
    } catch (error) {
      console.error('Failed to update availability:', error)
      // Revert the toggle if there was an error
      alert('Failed to update availability. Please try again.')
    }
  }

  // Get initials for avatar
  const getInitials = (name?: string, email?: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }
    if (email) {
      return email.substring(0, 2).toUpperCase()
    }
    return 'U'
  }

  const isActive = (path: string) => location.pathname.startsWith(path)

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="w-20 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col shadow-sm fixed left-0 top-0 bottom-0 z-40 md:relative">
        {/* Logo */}
        <div className="h-16 md:h-20 flex items-center justify-center border-b border-gray-200 dark:border-gray-700">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
            <span className="text-white font-bold text-lg">AC</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col py-4 md:py-6 gap-2 px-2">
          <Link
            to="/dashboard/chats"
            className={`flex items-center justify-center py-2.5 md:py-3 rounded-lg transition-all ${
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
            className={`flex items-center justify-center py-2.5 md:py-3 rounded-lg transition-all ${
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
            className={`flex items-center justify-center py-2.5 md:py-3 rounded-lg transition-all ${
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
        <div className="border-t border-gray-200 dark:border-gray-700 p-2 space-y-1.5 md:space-y-2">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="w-full flex items-center justify-center py-2.5 md:py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
            title={darkMode ? 'Light mode' : 'Dark mode'}
          >
            {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          
          {/* Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <div className="w-full flex items-center justify-center py-1.5 md:py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all cursor-pointer">
                <div className="relative">
                  <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-xs md:text-sm shadow-md">
                    {getInitials(user?.name, user?.email)}
                  </div>
                  {user?.is_available && (
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 md:w-3 md:h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></div>
                  )}
                </div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 md:w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {user?.name || 'User'}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-normal truncate">
                    {user?.email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">Available</span>
                  <Switch
                    checked={user?.is_available || false}
                    onCheckedChange={handleAvailabilityToggle}
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleLogout}
                className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 focus:bg-red-50 dark:focus:bg-red-900/20"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-20 md:ml-0">
        <Outlet />
      </main>
    </div>
  )
}
