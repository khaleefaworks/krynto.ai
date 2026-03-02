import { useAppStore } from "@/store/appStore"
import { isAdmin } from "@/lib/roles"
import { Link, useLocation, useSearchParams, Outlet } from "react-router-dom"
import {
  Globe,
  User as UserIcon,
  Users,
  Zap,
  ArrowLeft,
  Code,
  Settings as SettingsIcon,
  Palette,
  Bot,
  Tag as TagIcon,
  Trash2,
} from "lucide-react"


export default function Settings() {
  const { user } = useAppStore()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // Detect website detail route (numeric id only, not "new")
  const websiteMatch = location.pathname.match(
    /^\/dashboard\/settings\/websites\/(\d+)/
  )
  const websiteId = websiteMatch ? websiteMatch[1] : null

  const activeTab = searchParams.get("tab") || "installation"

  const isActive = (path: string, opts?: { exact?: boolean }) => {
    if (location.pathname === path) return true
    if (opts?.exact) return false
    return location.pathname.startsWith(`${path}/`)
  }

  const navLinkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active
      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200"
    }`

  const tabLinkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active
      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200"
    }`

  return (
    <div className="flex h-full">
      {/* Settings Sidebar */}
      <aside className="w-56 shrink-0 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col">
        {websiteId ? (
          /* ──── Website Detail: contextual vertical tabs ──── */
          <>
            <div className="px-5 border-b dark:border-gray-700 flex items-center h-16">
              <Link
                to="/dashboard/settings/websites"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Websites
              </Link>
            </div>

            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              <Link
                to={`/dashboard/settings/websites/${websiteId}?tab=installation`}
                className={tabLinkClass(activeTab === "installation")}
              >
                <Code className="h-4 w-4 shrink-0" />
                Installation
              </Link>
              <Link
                to={`/dashboard/settings/websites/${websiteId}?tab=settings`}
                className={tabLinkClass(activeTab === "settings")}
              >
                <SettingsIcon className="h-4 w-4 shrink-0" />
                General
              </Link>
              <Link
                to={`/dashboard/settings/websites/${websiteId}?tab=widget`}
                className={tabLinkClass(activeTab === "widget")}
              >
                <Palette className="h-4 w-4 shrink-0" />
                Widget
              </Link>
              <Link
                to={`/dashboard/settings/websites/${websiteId}?tab=automations`}
                className={tabLinkClass(activeTab === "automations")}
              >
                <Bot className="h-4 w-4 shrink-0" />
                Automations
              </Link>

              {isAdmin(user) && (
                <>
                  <div className="h-px bg-gray-200 dark:bg-gray-700 my-2" />
                  <Link
                    to={`/dashboard/settings/websites/${websiteId}?tab=teams`}
                    className={tabLinkClass(activeTab === "teams")}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    Teams
                  </Link>
                  <Link
                    to={`/dashboard/settings/websites/${websiteId}?tab=shortcuts`}
                    className={tabLinkClass(activeTab === "shortcuts")}
                  >
                    <Zap className="h-4 w-4 shrink-0" />
                    Shortcuts
                  </Link>
                  <Link
                    to={`/dashboard/settings/websites/${websiteId}?tab=tags`}
                    className={tabLinkClass(activeTab === "tags")}
                  >
                    <TagIcon className="h-4 w-4 shrink-0" />
                    Tags
                  </Link>
                </>
              )}
            </nav>

            {/* Danger zone at bottom */}
            {isAdmin(user) && (
              <div className="p-3 border-t dark:border-gray-700">
                <Link
                  to={`/dashboard/settings/websites/${websiteId}?tab=danger`}
                  className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === "danger"
                    ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                    : "text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    }`}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Website
                </Link>
              </div>
            )}
          </>
        ) : (
          /* ──── Default Settings Navigation ──── */
          <>
            <div className="px-5 border-b dark:border-gray-700 flex items-center h-16">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                Settings
              </h1>
            </div>

            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              {isAdmin(user) && (
                <>
                  <div className="px-3 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    General
                  </div>
                  <Link
                    to="/dashboard/settings/websites"
                    className={navLinkClass(
                      isActive("/dashboard/settings/websites")
                    )}
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    Websites
                  </Link>
                  <Link
                    to="/dashboard/settings/users"
                    className={navLinkClass(
                      isActive("/dashboard/settings/users")
                    )}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    Users
                  </Link>
                  <div className="h-3" />
                </>
              )}

              <div className="px-3 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Personal
              </div>
              <Link
                to="/dashboard/settings/personal"
                className={navLinkClass(
                  isActive("/dashboard/settings/personal", { exact: true })
                )}
              >
                <UserIcon className="h-4 w-4 shrink-0" />
                Profile
              </Link>
              <Link
                to="/dashboard/settings/personal/shortcuts"
                className={navLinkClass(
                  isActive("/dashboard/settings/personal/shortcuts")
                )}
              >
                <Zap className="h-4 w-4 shrink-0" />
                Shortcuts
              </Link>
            </nav>
          </>
        )}
      </aside>

      {/* Settings Content */}
      <main className="flex-1 overflow-hidden relative bg-gray-50 dark:bg-gray-900">
        <Outlet />
      </main>
    </div>
  )
}
