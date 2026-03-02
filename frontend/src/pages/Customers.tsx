import { Link, Outlet, useLocation } from 'react-router-dom'
import { Users, UserRound } from 'lucide-react'

export default function Customers() {
    const location = useLocation()

    const isActive = (path: string, opts?: { exact?: boolean }) => {
        if (location.pathname === path) return true
        if (opts?.exact) return false
        return location.pathname.startsWith(`${path}/`)
    }

    return (
        <div className="flex h-screen">
            {/* Customers Sidebar */}
            <aside className="w-56 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
                <div className="px-6 h-16 border-b dark:border-gray-700 flex items-center">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Customers</h1>
                </div>

                <nav className="p-4">
                    <div className="space-y-1">
                        <Link
                            to="/dashboard/customers/visitors"
                            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/customers/visitors')
                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                }`}
                        >
                            <Users className="h-4 w-4" />
                            Visitors
                        </Link>

                        <Link
                            to="/dashboard/customers/contacts"
                            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${isActive('/dashboard/customers/contacts')
                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                }`}
                        >
                            <UserRound className="h-4 w-4" />
                            Contacts
                        </Link>
                    </div>
                </nav>
            </aside>

            {/* Customers Content */}
            <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                <Outlet />
            </main>
        </div>
    )
}
