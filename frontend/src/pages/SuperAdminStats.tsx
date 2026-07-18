import { useEffect, useState } from 'react'
import { Building2, Users, Globe, MessageSquare, RefreshCw, Radio, Eye, Clock } from 'lucide-react'
import {
    fetchPlatformStats,
    fetchSystemHealth,
    type PlatformStats,
    type SystemHealthResponse,
} from '@/services/admin'

export default function SuperAdminStats() {
    const [stats, setStats] = useState<PlatformStats | null>(null)
    const [health, setHealth] = useState<SystemHealthResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const [statsData, healthData] = await Promise.all([
                fetchPlatformStats(),
                fetchSystemHealth(),
            ])
            setStats(statsData)
            setHealth(healthData)
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

    const healthCards = health
        ? [
            { label: 'Live Agent Connections', value: health.active_agent_connections, icon: <Radio size={20} />, color: 'text-cyan-600 dark:text-cyan-400' },
            { label: 'Live Visitors', value: health.live_visitor_count, icon: <Eye size={20} />, color: 'text-teal-600 dark:text-teal-400' },
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
                <>
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

                    <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mt-8 mb-3">System Health</h2>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        {healthCards.map(({ label, value, icon, color }) => (
                            <div
                                key={label}
                                className="rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-5"
                            >
                                <div className={`mb-3 ${color}`}>{icon}</div>
                                <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">{value.toLocaleString()}</p>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
                            </div>
                        ))}
                        {health && (
                            <div className="rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-5 col-span-2 flex items-center gap-6">
                                <div>
                                    <p className="text-xs text-slate-400 mb-1">Database</p>
                                    <span className={`text-sm font-medium ${health.db === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {health.db === 'ok' ? 'Healthy' : 'Error'}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 mb-1">Redis</p>
                                    <span className={`text-sm font-medium ${health.redis === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : health.redis === 'disabled' ? 'text-slate-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {health.redis === 'ok' ? 'Healthy' : health.redis === 'disabled' ? 'Disabled' : 'Error'}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {health && health.scheduler_jobs.length > 0 && (
                        <div className="rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                            <div className="px-5 py-3 border-b border-slate-200 dark:border-gray-700 flex items-center gap-2">
                                <Clock size={15} className="text-slate-400" />
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Scheduled Jobs</span>
                            </div>
                            <div className="divide-y divide-slate-100 dark:divide-gray-700">
                                {health.scheduler_jobs.map((job) => (
                                    <div key={job.id} className="px-5 py-3 flex items-center justify-between text-sm">
                                        <span className="text-slate-700 dark:text-slate-200">{job.name}</span>
                                        <span className="text-slate-400 dark:text-slate-500">
                                            {job.next_run_time ? `Next: ${new Date(job.next_run_time).toLocaleString()}` : 'Not scheduled'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
