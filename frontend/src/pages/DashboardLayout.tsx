import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken, apiRequest } from '@/services/api'
import { isAdmin } from '@/lib/roles'
import { LogOut, MessageCircle, Settings, BarChart3, Moon, Sun, Menu, X, Users, UserCheck, Rocket, HelpCircle, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { updateAvailability } from '@/services/auth'
import { unsubscribeFromPush } from '@/services/push'
import Logo from '@/components/Logo'
import OnboardingWizard, { dismissOnboarding } from '@/components/OnboardingWizard'
import InstallPromptBanner from '@/components/InstallPromptBanner'
import { usePwaInstall } from '@/hooks/usePwaInstall'

import { API_BASE } from '@/config/endpoints'

function getFullAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const v = String(url)
  return v.startsWith('http') ? v : `${API_BASE}${v}`
}

export default function DashboardLayout() {
  const { user, setUser, setToken, unreadChatsCount, organization } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode')
    return saved ? JSON.parse(saved) : false
  })
  const [wizardOpen, setWizardOpen] = useState(false)
  const { isInstallable, install } = usePwaInstall()

  const onboardingScope = {
    orgId: organization?.id ?? user?.organization_id ?? null,
    orgSlug: organization?.slug ?? null,
    userId: user?.id ?? null,
    role: user?.role ?? null,
  }

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

  const handleLogout = async () => {
    // Unsubscribe push & revoke server session before clearing the local token.
    await unsubscribeFromPush()
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {})
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
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive('/dashboard/chats')
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <MessageCircle className="h-5 w-5" />
        <span className="md:hidden lg:block">Chats</span>
        {unreadChatsCount > 0 && (
          <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
            {unreadChatsCount > 99 ? '99+' : unreadChatsCount}
          </span>
        )}
      </Link>

      <Link
        to="/dashboard/customers/visitors"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive('/dashboard/customers')
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <Users className="h-5 w-5" />
        <span className="md:hidden lg:block">Customers</span>
      </Link>

      <Link
        to="/dashboard/teams"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive('/dashboard/teams')
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <UserCheck className="h-5 w-5" />
        <span className="md:hidden lg:block">Teams</span>
      </Link>

      <Link
        to="/dashboard/settings"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive('/dashboard/settings')
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <Settings className="h-5 w-5" />
        <span className="md:hidden lg:block">Settings</span>
      </Link>

      <Link
        to="/dashboard/analytics"
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive('/dashboard/analytics')
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <BarChart3 className="h-5 w-5" />
        <span className="md:hidden lg:block">Analytics</span>
      </Link>

    </>
  )

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Mobile Header */}
      {/* On iOS PWA with viewport-fit=cover, pt-[var(--sat)] pushes content below the notch */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 z-50 pt-[var(--sat)] min-h-[calc(4rem+var(--sat))]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Menu className="h-6 w-6 text-gray-700 dark:text-gray-300" />
          </button>
          <div className="flex items-center gap-2">
            <Logo size={32} dotColor={user?.is_available ? '#22c55e' : '#ef4444'} />
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
          <Link
            to="/docs/getting-started/introduction"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Help Center"
          >
            <HelpCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
          </Link>
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
            <Logo size={32} dotColor={user?.is_available ? '#22c55e' : '#ef4444'} />
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
              {getFullAvatarUrl((user as any)?.avatar_url) ? (
                <img
                  src={getFullAvatarUrl((user as any)?.avatar_url) as string}
                  alt={user?.name || user?.email || 'User'}
                  className="w-12 h-12 rounded-full object-cover shadow-md"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold shadow-md">
                  {getInitials(user?.name, user?.email)}
                </div>
              )}
              <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-white dark:border-gray-800 rounded-full ${user?.is_available ? 'bg-green-500' : 'bg-red-500'}`}></div>
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
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-1">
          {isAdmin(user) && (
            <button
              onClick={() => { setIsMobileMenuOpen(false); setWizardOpen(true) }}
              className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all"
            >
              <Rocket className="h-5 w-5" />
              <span>Setup Guide</span>
            </button>
          )}
          {isInstallable && (
            <button
              onClick={() => { setIsMobileMenuOpen(false); install() }}
              className="w-full flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all"
            >
              <Download className="h-5 w-5" />
              <span>Install App</span>
            </button>
          )}
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
          <Logo size={40} dotColor={user?.is_available ? '#22c55e' : '#ef4444'} />
        </div>

        {/* Desktop Navigation - Icon Only */}
        <TooltipProvider>
          <nav className="flex-1 flex flex-col py-6 gap-2 px-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/chats"
                  className={`relative flex items-center justify-center py-3 rounded-lg transition-all ${isActive('/dashboard/chats')
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <MessageCircle className="h-5 w-5" />
                  {unreadChatsCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                      {unreadChatsCount > 99 ? '99+' : unreadChatsCount}
                    </span>
                  )}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Chats</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/customers/visitors"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${isActive('/dashboard/customers')
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <Users className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Customers</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/teams"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${isActive('/dashboard/teams')
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <UserCheck className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Teams</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/analytics"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${isActive('/dashboard/analytics')
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/docs/getting-started/introduction"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                >
                  <HelpCircle className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Help Center</p>
              </TooltipContent>
            </Tooltip>

            {isAdmin(user) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setWizardOpen(true)}
                    className="w-full flex items-center justify-center py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                  >
                    <Rocket className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Setup Guide</p>
                </TooltipContent>
              </Tooltip>
            )}

            {isInstallable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={install}
                    className="w-full flex items-center justify-center py-3 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                  >
                    <Download className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Install App</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/dashboard/settings"
                  className={`flex items-center justify-center py-3 rounded-lg transition-all ${isActive('/dashboard/settings')
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

            {/* Desktop Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className="w-full flex items-center justify-center py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all cursor-pointer">
                  <div className="relative">
                    {getFullAvatarUrl((user as any)?.avatar_url) ? (
                      <img
                        src={getFullAvatarUrl((user as any)?.avatar_url) as string}
                        alt={user?.name || user?.email || 'User'}
                        className="w-10 h-10 rounded-full object-cover shadow-md"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm shadow-md">
                        {getInitials(user?.name, user?.email)}
                      </div>
                    )}
                    <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-white dark:border-gray-800 rounded-full ${user?.is_available ? 'bg-green-500' : 'bg-red-500'}`}></div>
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
      <main className="flex-1 pt-[calc(4rem+var(--sat))] md:pt-0 overflow-hidden min-h-0">
        <Outlet />
      </main>

      {/* Onboarding Wizard */}
      <OnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDismiss={() => {
          dismissOnboarding(onboardingScope)
          setWizardOpen(false)
        }}
      />
      <InstallPromptBanner />
    </div>
  )
}
