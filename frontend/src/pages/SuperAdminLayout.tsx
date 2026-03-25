import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { clearToken } from '@/services/api'
import Logo from '@/components/Logo'
import { Building2, BarChart3, LogOut } from 'lucide-react'
import NotificationToasts from '@/components/NotificationToasts'

export default function SuperAdminLayout() {
    const { user, setUser, setToken } = useAppStore()
    const navigate = useNavigate()

    const onLogout = () => {
        clearToken()
        setUser(null)
        setToken(null)
        navigate('/login', { replace: true })
    }

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-gray-900">
            <NotificationToasts />
            {/* Sidebar */}
            <aside className="w-56 flex flex-col bg-white dark:bg-gray-800 border-r border-slate-200 dark:border-gray-700 shrink-0">
                <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-200 dark:border-gray-700">
                    <Logo size={28} />
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Super Admin</span>
                </div>

                <nav className="flex-1 p-2 space-y-1">
                    <NavLink
                        to="/superadmin/organizations"
                        className={({ isActive }) =>
                            `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive
                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-700'
                            }`
                        }
                    >
                        <Building2 size={16} />
                        Organizations
                    </NavLink>
                    <NavLink
                        to="/superadmin/stats"
                        className={({ isActive }) =>
                            `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive
                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-700'
                            }`
                        }
                    >
                        <BarChart3 size={16} />
                        Platform Stats
                    </NavLink>
                </nav>

                <div className="p-3 border-t border-slate-200 dark:border-gray-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mb-2">{user?.email}</p>
                    <button
                        onClick={onLogout}
                        className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <LogOut size={15} />
                        Logout
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    )
}
