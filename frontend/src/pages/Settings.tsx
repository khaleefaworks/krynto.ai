import { useAppStore } from "@/store/appStore"
import { isAdmin } from "@/lib/roles"
import { Link, useLocation, Outlet } from "react-router-dom"
import { Globe, User as UserIcon, Users, Tag, Zap } from "lucide-react"

export default function Settings() {
  const { user } = useAppStore()
  const location = useLocation()

  const isActive = (path: string, opts?: { exact?: boolean }) => {
    if (location.pathname === path) return true
    if (opts?.exact) return false
    return location.pathname.startsWith(`${path}/`)
  }

  return (
    <div className="flex h-screen">
      {/* Settings Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
        <div className="p-6 border-b dark:border-gray-700">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        </div>

        <nav className="p-4">
          <div className="space-y-1">
            {/* General Section - Admin Only */}
            {isAdmin(user) && (
              <>
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  General
                </div>
                <Link
                  to="/dashboard/settings/websites"
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/settings/websites')
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                >
                  <Globe className="h-4 w-4" />
                  Websites
                </Link>
                <Link
                  to="/dashboard/settings/users"
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/settings/users')
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                >
                  <Users className="h-4 w-4" />
                  Users
                </Link>
                <Link
                  to="/dashboard/settings/tags"
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/settings/tags')
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                >
                  <Tag className="h-4 w-4" />
                  Tags
                </Link>
                <div className="mb-4" />
              </>
            )}

            {/* Personal Section - All Users */}
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Personal
            </div>
            <Link
              to="/dashboard/settings/personal"
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/settings/personal', { exact: true })
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
            >
              <UserIcon className="h-4 w-4" />
              Profile
            </Link>

            <Link
              to="/dashboard/settings/personal/shortcuts"
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/settings/personal/shortcuts')
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
            >
              <Zap className="h-4 w-4" />
              Shortcuts
            </Link>
          </div>
        </nav>
      </aside>

      {/* Settings Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <Outlet />
      </main>
    </div>
  )
}
