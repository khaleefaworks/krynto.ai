import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Search, X, Users as UsersIcon, RefreshCw } from 'lucide-react'
import { fetchAdminUsers, type AdminUserResponse } from '@/services/admin'

export default function SuperAdminUsers() {
    const [users, setUsers] = useState<AdminUserResponse[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState('')

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await fetchAdminUsers()
            setUsers(data)
        } catch (e: any) {
            setError(e?.message || 'Failed to load users')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return users
        return users.filter((u) => {
            const name = (u.name || '').toLowerCase()
            const email = u.email.toLowerCase()
            const org = (u.organization_name || '').toLowerCase()
            return name.includes(q) || email.includes(q) || org.includes(q)
        })
    }, [users, query])

    return (
        <div>
            <div className="h-16 flex items-center justify-between gap-4 border-b dark:border-gray-700 px-4 sm:px-6">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Users</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">All users across every organization</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        <span className="font-medium text-gray-900 dark:text-white">{filtered.length}</span> users
                    </div>
                    <button
                        onClick={load}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3 px-4 sm:px-6 py-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search name, email, organization..."
                        className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="mx-4 sm:mx-6 mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !users.length ? (
                <div className="text-center py-16 text-slate-400">Loading…</div>
            ) : filtered.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center mx-4 sm:mx-6 mb-6">
                    <UsersIcon size={32} className="mx-auto mb-3 opacity-30" />
                    <div className="text-gray-600 dark:text-gray-400">
                        {users.length === 0 ? 'No users found.' : 'No users match your search.'}
                    </div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mx-4 sm:mx-6 mb-6">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                                <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                                <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Organization</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filtered.map((u) => (
                                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.name || '—'}</div>
                                        <div className="sm:hidden text-xs text-gray-500 dark:text-gray-400 capitalize">{u.role.replace(/_/g, ' ')}</div>
                                    </td>
                                    <td className="px-4 py-3 max-w-[160px] sm:max-w-none">
                                        <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{u.email}</div>
                                    </td>
                                    <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap">
                                        <Badge variant="outline" className="text-xs capitalize">{u.role.replace(/_/g, ' ')}</Badge>
                                    </td>
                                    <td className="hidden md:table-cell px-4 py-3">
                                        <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{u.organization_name || '—'}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <Badge variant={u.is_active ? 'default' : 'secondary'} className="text-xs">
                                            {u.is_active ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
