import { useEffect, useState } from 'react'
import { apiRequest } from '@/services/api'
import { Building2, Users, Globe, MessageSquare, RefreshCw } from 'lucide-react'

interface PlatformStats {
    total_organizations: number
    active_organizations: number
    total_users: number
    total_websites: number
    total_conversations: number
}

export default function SuperAdminStats() {
    const [stats, setStats] = useState<PlatformStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiRequest<PlatformStats>('/admin/stats')
            setStats(data)
        } catch (e: any) {
            setError(e?.message || 'Failed to load stats')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    const cards = stats
        ? [
            { label: 'Total Organizations', value: stats.total_organizations, sub: `${stats.active_organizations} active`, icon: <Building2 size={20} />, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Total Users', value: stats.total_users, icon: <Users size={20} />, color: 'text-purple-600 dark:text-purple-400' },
            { label: 'Total Websites', value: stats.total_websites, icon: <Globe size={20} />, color: 'text-green-600 dark:text-green-400' },
            { label: 'Total Conversations', value: stats.total_conversations, icon: <MessageSquare size={20} />, color: 'text-orange-600 dark:text-orange-400' },
        ]
        : []

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Platform Stats</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">High-level metrics across all tenants</p>
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

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !stats ? (
                <div className="text-center py-16 text-slate-400">Loading…</div>
            ) : (
                <div className="grid grid-cols-2 gap-4">
                    {cards.map(({ label, value, sub, icon, color }) => (
                        <div
                            key={label}
                            className="rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-5"
                        >
                            <div className={`mb-3 ${color}`}>{icon}</div>
                            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">{value.toLocaleString()}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
                            {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
