import { useEffect, useState } from 'react'
import { ShieldAlert, RefreshCw } from 'lucide-react'
import {
    fetchSecurityEvents,
    fetchOrganizations,
    type SecurityEventResponse,
    type OrgStats,
} from '@/services/admin'

const EVENT_TYPES = [
    'login_success',
    'login_failed',
    'login_lockout',
    'password_changed',
    'role_changed',
    'user_activated',
    'user_deactivated',
    'org_suspended',
    'org_reactivated',
    'org_plan_changed',
] as const

const EVENT_LABEL: Record<string, string> = {
    login_success: 'Login succeeded',
    login_failed: 'Login failed',
    login_lockout: 'Account locked out',
    password_changed: 'Password changed',
    role_changed: 'Role changed',
    user_activated: 'User activated',
    user_deactivated: 'User deactivated',
    org_suspended: 'Organization suspended',
    org_reactivated: 'Organization reactivated',
    org_plan_changed: 'Organization plan changed',
}

const PAGE_SIZE = 50

function describeMetadata(event: SecurityEventResponse): string | null {
    const m = event.metadata
    if (!m) return null
    if (event.event_type === 'role_changed' && m.old_role && m.new_role) {
        return `${m.old_role} → ${m.new_role}`
    }
    if (event.event_type === 'org_plan_changed' && m.old_plan && m.new_plan) {
        return `${m.old_plan} → ${m.new_plan}`
    }
    if (event.event_type === 'login_failed' || event.event_type === 'login_lockout') {
        if (m.attempts) return `attempt #${m.attempts}`
    }
    return null
}

export default function SuperAdminSecurityLog() {
    const [events, setEvents] = useState<SecurityEventResponse[]>([])
    const [total, setTotal] = useState(0)
    const [orgs, setOrgs] = useState<OrgStats[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [offset, setOffset] = useState(0)

    const [eventType, setEventType] = useState('')
    const [organizationId, setOrganizationId] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')

    useEffect(() => {
        fetchOrganizations().then(setOrgs).catch(() => {})
    }, [])

    const load = async (nextOffset = 0) => {
        setLoading(true)
        setError(null)
        try {
            const data = await fetchSecurityEvents({
                event_type: eventType || undefined,
                organization_id: organizationId ? Number(organizationId) : undefined,
                date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
                date_to: dateTo ? new Date(dateTo).toISOString() : undefined,
                limit: PAGE_SIZE,
                offset: nextOffset,
            })
            setEvents((prev) => (nextOffset === 0 ? data.items : [...prev, ...data.items]))
            setTotal(data.total)
            setOffset(nextOffset)
        } catch (e: any) {
            setError(e?.message || 'Failed to load security events')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load(0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventType, organizationId, dateFrom, dateTo])

    const hasMore = events.length < total

    return (
        <div>
            <div className="h-16 flex items-center justify-between gap-4 border-b dark:border-gray-700 px-4 sm:px-6">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Activity Log</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Security and account events across the platform</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        <span className="font-medium text-gray-900 dark:text-white">{total}</span> events
                    </div>
                    <button
                        onClick={() => load(0)}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3">
                <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    className="rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="">All event types</option>
                    {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>{EVENT_LABEL[t] || t}</option>
                    ))}
                </select>

                <select
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    className="rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="">All organizations</option>
                    {orgs.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                </select>

                <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-400">to</span>
                <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>

            {error && (
                <div className="mx-4 sm:mx-6 mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !events.length ? (
                <div className="text-center py-16 text-slate-400">Loading…</div>
            ) : events.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center mx-4 sm:mx-6 mb-6">
                    <ShieldAlert size={32} className="mx-auto mb-3 opacity-30" />
                    <div className="text-gray-600 dark:text-gray-400">No events match these filters.</div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mx-4 sm:mx-6 mb-6">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Event</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actor</th>
                                <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Target</th>
                                <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Organization</th>
                                <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</th>
                                <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">When</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {events.map((ev) => (
                                <tr key={ev.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                            {EVENT_LABEL[ev.event_type] || ev.event_type}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{ev.actor_email || '—'}</div>
                                    </td>
                                    <td className="hidden sm:table-cell px-4 py-3">
                                        <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{ev.target_email || '—'}</div>
                                    </td>
                                    <td className="hidden md:table-cell px-4 py-3">
                                        <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{ev.organization_name || '—'}</div>
                                    </td>
                                    <td className="hidden lg:table-cell px-4 py-3">
                                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{describeMetadata(ev) || '—'}</div>
                                    </td>
                                    <td className="hidden sm:table-cell px-4 py-3">
                                        <div className="text-sm text-gray-500 dark:text-gray-400 font-mono">{ev.ip_address || '—'}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                            {ev.created_at ? new Date(ev.created_at).toLocaleString() : '—'}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {hasMore && (
                        <div className="flex justify-center py-4 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={() => load(offset + PAGE_SIZE)}
                                disabled={loading}
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                            >
                                {loading ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
