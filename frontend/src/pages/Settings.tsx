import { useAppStore } from "@/store/appStore"
import { isAdmin } from "@/lib/roles"
import { Link, useLocation } from "react-router-dom"
import { Globe, User as UserIcon } from "lucide-react"

export default function Settings() {
  const { user } = useAppStore()
  const location = useLocation()

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="flex h-screen">
      {/* Settings Sidebar */}
      <aside className="w-64 bg-white border-r">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        </div>

        <nav className="p-4">
          <div className="space-y-1">
            {/* Websites Section - Admin Only */}
            {isAdmin(user) && (
              <>
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Websites
                </div>
                <Link
                  to="/dashboard/settings/websites"
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                    isActive('/dashboard/settings/websites')
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  Manage Websites
                </Link>
                <div className="mb-4" />
              </>
            )}

            {/* Personal Section - All Users */}
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Personal
            </div>
            <Link
              to="/dashboard/settings/personal"
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                isActive('/dashboard/settings/personal')
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <UserIcon className="h-4 w-4" />
              Profile & Availability
            </Link>
          </div>
        </nav>
      </aside>

      {/* Settings Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-8">
        <div className="max-w-4xl">
          <div className="text-center text-gray-500 py-12">
            Select a settings section from the sidebar
          </div>
        </div>
      </main>
    </div>
  )
}
