import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import { LogOut, MessageSquare, Settings, BarChart3, Moon, Sun, Menu, X, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { updateAvailability } from '@/services/auth'
import Logo from '@/components/Logo'
import { isAdministrator } from '@/lib/roles'

export default function DashboardLayout() {
  const { user, setUser, setToken, unreadChatsCount } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
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

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  const handleLogout = () => {
    clearToken()
    setUser(null)
    setToken(null)
    navigate('/login')
  }

  const handleAvailabilityToggle = async (checked: boolean) => {
    if (!user) return
    
    try {
      const response = await updateAvailability(checked)
      setUser({ ...user, is_available: response.is_available })
    } catch (error) {
      console.error('Failed to update availability:', error)
      alert('Failed to update availability. Please try again.')
    }
  }

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

  const NavigationLinks = () => (
    <>
      <Link
        to="/dashboard/chats"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all relative ${
          isActive('/dashboard/chats') 
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' 
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <div className="relative">
          <MessageSquare className="h-5 w-5" />
          {unreadChatsCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center animate-pulse">
              {unreadChatsCount > 9 ? '9+' : unreadChatsCount}
            </span>
          )}
        </div>
        <span className="md:hidden lg:block">Chats</span>
        {unreadChatsCount > 0 && (
          <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 md:hidden lg:block">
            {unreadChatsCount}
          </span>
        )}
      </Link>

      <Link
        to="/dashboard/settings"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
          isActive('/dashboard/settings') 
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' 
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <Settings className="h-5 w-5" />
        <span className="md:hidden lg:block">Settings</span>
      </Link>

      <Link
        to="/dashboard/analytics"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
          isActive('/dashboard/analytics') 
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' 
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <BarChart3 className="h-5 w-5" />
        <span className="md:hidden lg:block">Analytics</span>
      </Link>

      {/* Reset Application - Administrator Only */}
      {isAdministrator(user) && (
        <Link
          to="/dashboard/reset"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
            isActive('/dashboard/reset') 
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' 
              : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          }`}
        >
          <RotateCcw className="h-5 w-5" />
          <span className="md:hidden lg:block">Reset App</span>
        </Link>
      )}
    </>
  )

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Menu className="h-6 w-6 text-gray-700 dark:text-gray-300" />
          </button>
          <div className="flex items-center gap-2">
            <Logo size={32} />
            <span className="font-semibold text-gray-900 dark:text-white">AI ChatAssist</span>
          </div>
        </div>
        
        {/* Mobile Profile */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {darkMode ? <Sun className="h-5 w-5 text-gray-700 dark:text-gray-300" /> : <Moon className="h-5 w-5 text-gray-700 dark:text-gray-300" />}
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/50 z-50"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Sliding Sidebar */}
      <aside className={`
        md:hidden fixed top-0 left-0 bottom-0 w-72 bg-white dark:bg-gray-800 z-50
        transform transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Mobile Sidebar Header */}
        <div className="h-16 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Logo size={32} />
            <span className="font-semibold text-gray-900 dark:text-white">AI ChatAssist</span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        {/* Mobile Profile Section */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold shadow-md">
                {getInitials(user?.name, user?.email)}
              </div>
              {user?.is_available && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {user?.email}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">Available</span>
            <Switch
              checked={user?.is_available || false}
              onCheckedChange={handleAvailabilityToggle}
            />
          </div>
        </div>

        {/* Mobile Navigation */}
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            <NavigationLinks />
          </div>
        </nav>

        {/* Mobile Sidebar Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
          >
            <LogOut className="h-5 w-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-16 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col shadow-sm">
        {/* Desktop Logo */}
        <div className="h-16 flex items-center justify-center border-b border-gray-200 dark:border-gray-700">
          <Logo size={40} />
        </div>

        {/* Desktop Navigation - Icon Only */}
        <TooltipProvider>
          <nav className="flex-1 flex flex-col py-6 gap-2 px-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/chats"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${
                    isActive('/dashboard/chats') 
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm' 
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <MessageSquare className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Chats</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/settings"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${
                    isActive('/dashboard/settings') 
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm' 
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Settings className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Settings</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/analytics"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${
                    isActive('/dashboard/analytics') 
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm' 
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <BarChart3 className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Analytics</p>
              </TooltipContent>
            </Tooltip>
          </nav>

          {/* Desktop Bottom Actions */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-2 space-y-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className="w-full flex items-center justify-center py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                >
                  {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{darkMode ? 'Light mode' : 'Dark mode'}</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Desktop Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className="w-full flex items-center justify-center py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all cursor-pointer">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm shadow-md">
                      {getInitials(user?.name, user?.email)}
                    </div>
                    {user?.is_available && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></div>
                    )}
                  </div>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
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
        </TooltipProvider>
      </aside>

      {/* Main Content */}
      <main className="flex-1 pt-16 md:pt-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
