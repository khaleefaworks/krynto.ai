import { useAppStore } from "@/store/appStore"
import { isAdmin, isAdministrator, isOrgOwner } from "@/lib/roles"
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
  Building2,
  Bell,
  FileText,
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

  // Build mobile tab items based on current context
  const mobileTabClass = (active: boolean) =>
    `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
      active
        ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
    }`

  return (
    <div className="flex flex-col h-full">
      {/* Mobile nav tabs — shown below md */}
      <nav className="md:hidden flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto flex-shrink-0">
        {websiteId ? (
          <>
            <Link to="/dashboard/settings/websites" className={mobileTabClass(false)}>
              <ArrowLeft className="h-4 w-4" />
              Websites
            </Link>
            <Link to={`/dashboard/settings/websites/${websiteId}?tab=installation`} className={mobileTabClass(activeTab === 'installation')}>
              <Code className="h-4 w-4" />Installation
            </Link>
            <Link to={`/dashboard/settings/websites/${websiteId}?tab=settings`} className={mobileTabClass(activeTab === 'settings')}>
              <SettingsIcon className="h-4 w-4" />General
            </Link>
            <Link to={`/dashboard/settings/websites/${websiteId}?tab=widget`} className={mobileTabClass(activeTab === 'widget')}>
              <Palette className="h-4 w-4" />Widget
            </Link>
            <Link to={`/dashboard/settings/websites/${websiteId}?tab=automations`} className={mobileTabClass(activeTab === 'automations')}>
              <Bot className="h-4 w-4" />Automations
            </Link>
            {isAdmin(user) && (
              <>
                <Link to={`/dashboard/settings/websites/${websiteId}?tab=teams`} className={mobileTabClass(activeTab === 'teams')}>
                  <Users className="h-4 w-4" />Teams
                </Link>
                <Link to={`/dashboard/settings/websites/${websiteId}?tab=shortcuts`} className={mobileTabClass(activeTab === 'shortcuts')}>
                  <Zap className="h-4 w-4" />Shortcuts
                </Link>
                <Link to={`/dashboard/settings/websites/${websiteId}?tab=tags`} className={mobileTabClass(activeTab === 'tags')}>
                  <TagIcon className="h-4 w-4" />Tags
                </Link>
                <Link to={`/dashboard/settings/websites/${websiteId}?tab=forms`} className={mobileTabClass(activeTab === 'forms')}>
                  <FileText className="h-4 w-4" />Forms
                </Link>
              </>
            )}
          </>
        ) : (
          <>
            {isAdmin(user) && (
              <>
                <Link to="/dashboard/settings/websites" className={mobileTabClass(isActive('/dashboard/settings/websites'))}>
                  <Globe className="h-4 w-4" />Websites
                </Link>
                <Link to="/dashboard/settings/users" className={mobileTabClass(isActive('/dashboard/settings/users'))}>
                  <Users className="h-4 w-4" />Users
                </Link>
                {isOrgOwner(user) && (
                  <Link to="/dashboard/settings/organization" className={mobileTabClass(isActive('/dashboard/settings/organization'))}>
                    <Building2 className="h-4 w-4" />Organization
                  </Link>
                )}
              </>
            )}
            <Link to="/dashboard/settings/personal" className={mobileTabClass(isActive('/dashboard/settings/personal', { exact: true }))}>
              <UserIcon className="h-4 w-4" />Profile
            </Link>
            <Link to="/dashboard/settings/personal/notifications" className={mobileTabClass(isActive('/dashboard/settings/personal/notifications'))}>
              <Bell className="h-4 w-4" />Notifications
            </Link>
            <Link to="/dashboard/settings/personal/shortcuts" className={mobileTabClass(isActive('/dashboard/settings/personal/shortcuts'))}>
              <Zap className="h-4 w-4" />Shortcuts
            </Link>
          </>
        )}
      </nav>

      <div className="flex flex-1 min-h-0">
      {/* Settings Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 shrink-0 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex-col">
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
                  <Link
                    to={`/dashboard/settings/websites/${websiteId}?tab=forms`}
                    className={tabLinkClass(activeTab === "forms")}
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    Forms
                  </Link>
                </>
              )}
            </nav>

            {/* Danger zone at bottom */}
            {isAdministrator(user) && (
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
                  {isOrgOwner(user) && (
                    <Link
                      to="/dashboard/settings/organization"
                      className={navLinkClass(
                        isActive("/dashboard/settings/organization")
                      )}
                    >
                      <Building2 className="h-4 w-4 shrink-0" />
                      Organization
                    </Link>
                  )}
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
                to="/dashboard/settings/personal/notifications"
                className={navLinkClass(
                  isActive("/dashboard/settings/personal/notifications")
                )}
              >
                <Bell className="h-4 w-4 shrink-0" />
                Notifications
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
    </div>
  )
}
