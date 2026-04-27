import { Link, Outlet, useLocation } from 'react-router-dom'
import { Users, UserRound } from 'lucide-react'

export default function Customers() {
    const location = useLocation()

    const isActive = (path: string, opts?: { exact?: boolean }) => {
        if (location.pathname === path) return true
        if (opts?.exact) return false
        return location.pathname.startsWith(`${path}/`)
    }

    const navLinkClass = (active: boolean) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
            active
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
        }`

    const mobileTabClass = (active: boolean) =>
        `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            active
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`

    return (
        <div className="flex flex-col h-full">
            {/* Mobile tabs — shown below md */}
            <nav className="md:hidden flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto flex-shrink-0">
                <Link to="/dashboard/customers/visitors" className={mobileTabClass(isActive('/dashboard/customers/visitors'))}>
                    <Users className="h-4 w-4" />
                    Visitors
                </Link>
                <Link to="/dashboard/customers/contacts" className={mobileTabClass(isActive('/dashboard/customers/contacts'))}>
                    <UserRound className="h-4 w-4" />
                    Contacts
                </Link>
            </nav>

            <div className="flex flex-1 min-h-0">
                {/* Customers Sidebar — desktop only */}
                <aside className="hidden md:flex flex-col w-56 flex-shrink-0 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
                    <div className="px-6 h-16 border-b dark:border-gray-700 flex items-center">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Customers</h1>
                    </div>

                    <nav className="p-4">
                        <div className="space-y-1">
                            <Link to="/dashboard/customers/visitors" className={navLinkClass(isActive('/dashboard/customers/visitors'))}>
                                <Users className="h-4 w-4" />
                                Visitors
                            </Link>
                            <Link to="/dashboard/customers/contacts" className={navLinkClass(isActive('/dashboard/customers/contacts'))}>
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
        </div>
    )
}
