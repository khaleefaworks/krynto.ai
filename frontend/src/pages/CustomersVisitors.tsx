import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Search, X, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import type { CustomerVisitor, CustomerVisitorDetails } from '@/services/customers'
import { fetchVisitorDetails, fetchVisitors } from '@/services/customers'
import { addMessageHandler, connectAgentSocket } from '@/services/agentSocket'
import { isAdmin } from '@/lib/roles'
import { playNewVisitorOnWebsiteSound } from '@/lib/notificationSound'
import { websitesApi } from '@/services/websites'
import { agentAssignmentsApi } from '@/services/agentAssignments'
import UserAvatar from '@/components/UserAvatar'
import DocsLink from '@/components/DocsLink'
import { API_BASE } from '@/config/endpoints'

function formatOnlineSeconds(seconds: number | null): string {
    if (seconds == null) return '-'
    if (seconds < 60) return `${seconds} s`
    const mins = Math.floor(seconds / 60)
    if (mins < 60) return `${mins} m`
    const hours = Math.floor(mins / 60)
    return `${hours} h`
}

function safeHostFromUrl(url: string | null | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url).hostname
    } catch {
        return null
    }
}

function shortSessionId(sessionId: string | null | undefined): string {
    const raw = String(sessionId || '').trim()
    if (!raw) return ''
    const lastSegment = raw.split('-').filter(Boolean).pop() || raw
    if (lastSegment.length >= 12) return lastSegment.slice(-12)
    const compact = raw.replace(/-/g, '')
    return compact.length >= 12 ? compact.slice(-12) : raw
}

function getInitials(name: string | null | undefined, fallback: string): string {
    const v = String(name || '').trim()
    if (!v) return fallback
    const parts = v.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] || ''
    const second = (parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1]) || ''
    return (first + second).toUpperCase() || fallback
}

function toFullAvatarUrl(raw: string | null | undefined): string | null {
    const v = String(raw || '').trim()
    if (!v) return null
    if (v.startsWith('http://') || v.startsWith('https://')) return v
    return `${API_BASE}${v}`
}

function getVisitorDisplayName(row: CustomerVisitor | null | undefined): string {
    const name = String((row as any)?.visitor_name || '').trim()
    if (name) return name
    return shortSessionId((row as any)?.session_id)
}

export default function CustomersVisitors() {
    const navigate = useNavigate()
    const user = useAppStore((s) => s.user)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [rows, setRows] = useState<CustomerVisitor[]>([])
    const [query, setQuery] = useState('')
    const [filterWebsite, setFilterWebsite] = useState<number | 'all'>('all')
    const [filterOnline, setFilterOnline] = useState<'all' | 'online' | 'offline'>('all')

    const [websiteLabels, setWebsiteLabels] = useState<Record<number, string>>({})
    const [websiteIds, setWebsiteIds] = useState<number[]>([])

    const [selected, setSelected] = useState<{ websiteId: number; sessionId: string } | null>(null)
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [detailsError, setDetailsError] = useState<string | null>(null)
    const [details, setDetails] = useState<CustomerVisitorDetails | null>(null)

    // Confirm modal state for bot-only conversations
    const [confirmBotConv, setConfirmBotConv] = useState<{ shortId: string | null; conversationId: number } | null>(null)

    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const refreshDetailsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const refreshList = async () => {
        const data = await fetchVisitors({ limit: 200, recentlyLeftWithinSeconds: 600 })
        setRows(Array.isArray(data) ? data : [])
    }

    const scheduleRefreshList = () => {
        if (refreshTimerRef.current) return
        refreshTimerRef.current = setTimeout(async () => {
            refreshTimerRef.current = null
            try {
                await refreshList()
            } catch {
                // ignore
            }
        }, 250)
    }

    const scheduleRefreshDetails = () => {
        if (!selected) return
        if (refreshDetailsTimerRef.current) return
        refreshDetailsTimerRef.current = setTimeout(async () => {
            refreshDetailsTimerRef.current = null
            try {
                const data = await fetchVisitorDetails({
                    websiteId: selected.websiteId,
                    sessionId: selected.sessionId,
                    recentlyLeftWithinSeconds: 600,
                    pageViewLimit: 50,
                })
                setDetails(data)
            } catch {
                // ignore
            }
        }, 300)
    }

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            try {
                setLoading(true)
                setError(null)
                const data = await fetchVisitors({ limit: 200, recentlyLeftWithinSeconds: 600 })
                if (!cancelled) setRows(Array.isArray(data) ? data : [])
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Failed to load visitors')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (!user?.id) return
            try {
                if (isAdmin(user)) {
                    const sites = await websitesApi.list()
                    if (cancelled) return
                    const next: Record<number, string> = {}
                    const ids: number[] = []
                    for (const s of (Array.isArray(sites) ? sites : [])) {
                        const id = Number((s as any).id)
                        if (!Number.isFinite(id)) continue
                        const domain = String((s as any).domain || '').trim()
                        const name = String((s as any).name || '').trim()
                        next[id] = domain || name || `#${id}`
                        ids.push(id)
                    }
                    setWebsiteLabels(next)
                    setWebsiteIds(ids)
                } else {
                    const sites = await agentAssignmentsApi.getAgentWebsites(user.id)
                    if (cancelled) return
                    const next: Record<number, string> = {}
                    const ids: number[] = []
                    for (const s of (Array.isArray(sites) ? sites : [])) {
                        const id = Number((s as any).id)
                        if (!Number.isFinite(id)) continue
                        const domain = String((s as any).domain || '').trim()
                        const name = String((s as any).name || '').trim()
                        next[id] = domain || name || `#${id}`
                        ids.push(id)
                    }
                    setWebsiteLabels(next)
                    setWebsiteIds(ids)
                }
            } catch {
                // ignore - fallback will render website_id
            }
        }

        run()
        return () => {
            cancelled = true
        }
    }, [user?.id, user?.role])

    // Realtime refresh: update visitor rows on connect/disconnect and first-message events.
    useEffect(() => {
        if (!user?.id) return

        try {
            connectAgentSocket(0, user.id)
        } catch {
            return
        }

        const off = addMessageHandler((data: any) => {
            const t = String(data?.type || '')
            if (
                t === 'visitor_session_presence' ||
                t === 'visitor_message' ||
                t === 'new_chat' ||
                t === 'conversation_assigned' ||
                t === 'page_view'
            ) {
                scheduleRefreshList()

                // Play 'New visitor on website' sound when a new chat starts
                if (t === 'new_chat') {
                    try { playNewVisitorOnWebsiteSound() } catch { }
                }

                // If drawer is open for this session, refresh the details too.
                const sid = String((data as any)?.session_id || '')
                const wid = Number((data as any)?.website_id)
                if (selected && sid && sid === selected.sessionId && Number.isFinite(wid) && wid === selected.websiteId) {
                    scheduleRefreshDetails()
                }
            }
        })

        return () => {
            try {
                off()
            } catch {
                // ignore
            }
        }
    }, [user?.id, selected])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (!selected) return
            try {
                const data = await fetchVisitorDetails({
                    websiteId: selected.websiteId,
                    sessionId: selected.sessionId,
                    recentlyLeftWithinSeconds: 600,
                    pageViewLimit: 50,
                })
                if (!cancelled) setDetails(data)
            } catch (e: any) {
                if (!cancelled) setDetailsError(e?.message || 'Failed to load visitor details')
            } finally {
                if (!cancelled) setDetailsLoading(false)
            }
        }

        run()
        return () => {
            cancelled = true
        }
    }, [selected])

    const closeDrawer = () => {
        setSelected(null)
        setDetails(null)
        setDetailsError(null)
        setDetailsLoading(false)
    }

    const openConversation = (shortId: string | null, conversationId: number) => {
        navigate(`/dashboard/chats/${shortId || conversationId}`)
        closeDrawer()
    }

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return rows.filter((r) => {
            // Website filter
            if (filterWebsite !== 'all' && r.website_id !== filterWebsite) return false
            // Online filter
            if (filterOnline === 'online' && !r.is_online) return false
            if (filterOnline === 'offline' && r.is_online) return false
            // Text search
            if (!q) return true
            const pageHost = safeHostFromUrl(r.current_page?.url)
            const cameFrom = r.came_from || ''
            return (
                shortSessionId(r.session_id).toLowerCase().includes(q) ||
                String((r as any).visitor_name || '').toLowerCase().includes(q) ||
                (r.current_page?.title || '').toLowerCase().includes(q) ||
                (pageHost || '').toLowerCase().includes(q) ||
                cameFrom.toLowerCase().includes(q) ||
                String((r as any).visitor_email || '').toLowerCase().includes(q)
            )
        })
    }, [rows, query, filterWebsite, filterOnline])

    if (loading) {
        return (
            <div className="p-8">
                <div className="flex items-center justify-center h-64">
                    <div className="text-gray-500 dark:text-gray-400">Loading visitors...</div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-8">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-red-800 dark:text-red-300">{error}</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <div className="h-16 flex items-center justify-between gap-4 border-b dark:border-gray-700 px-4 sm:px-6">
                <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Visitors</h1>
                    <DocsLink slug="agent-guide/visitors" />
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-900 dark:text-white">{filtered.length}</span> visitors
                </div>
            </div>

            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-b dark:border-gray-700">
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search name, email, page..."
                        className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Website filter — only show when multiple websites */}
                {websiteIds.length > 1 && (
                    <select
                        value={filterWebsite === 'all' ? 'all' : String(filterWebsite)}
                        onChange={(e) => setFilterWebsite(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                        className="py-1.5 pl-3 pr-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                        <option value="all">All websites</option>
                        {websiteIds.map((id) => (
                            <option key={id} value={String(id)}>{websiteLabels[id] || `#${id}`}</option>
                        ))}
                    </select>
                )}

                {/* Online/offline filter */}
                <div className="flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                    {(['all', 'online', 'offline'] as const).map((val) => (
                        <button
                            key={val}
                            onClick={() => setFilterOnline(val)}
                            className={`px-3 py-1.5 capitalize transition-colors ${filterOnline === val ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                        >
                            {val}
                        </button>
                    ))}
                </div>

                {(query || filterWebsite !== 'all' || filterOnline !== 'all') && (
                    <button
                        onClick={() => { setQuery(''); setFilterWebsite('all'); setFilterOnline('all') }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {filtered.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center mx-4 sm:mx-6 mb-6 mt-4">
                    <div className="text-gray-600 dark:text-gray-400">No visitors found</div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mx-4 sm:mx-6 mb-6 mt-4">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Visitor</th>
                                {websiteIds.length > 1 && <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Website</th>}
                                <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current page</th>
                                <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Came from</th>
                                <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Visits</th>
                                <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Chats</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filtered.map((r) => {
                                const pageHost = safeHostFromUrl(r.current_page?.url)
                                return (
                                    <tr
                                        key={`${r.website_id}:${r.session_id}`}
                                        onClick={() => setSelected({ websiteId: r.website_id, sessionId: r.session_id })}
                                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    {r.visitor_initiated_chat ? (
                                                        <span className="hidden sm:flex w-5 h-5 items-center justify-center" title="Visitor initiated chat">
                                                            <MessageCircle className="w-4 h-4 text-green-600 fill-green-200" />
                                                        </span>
                                                    ) : (
                                                        <span className="hidden sm:block w-5 h-5" />
                                                    )}

                                                    <div className="relative">
                                                        <UserAvatar
                                                            seed={String(r.session_id || 'visitor')}
                                                            bgColor={r.visitor_avatar_color}
                                                            className="w-9 h-9"
                                                            iconClassName="w-9 h-9"
                                                            title={shortSessionId(r.session_id)}
                                                        />

                                                        {r.is_online ? (
                                                            <span className="absolute -left-0.5 -top-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-800" />
                                                        ) : null}

                                                        {r.agent_joined && r.assigned_agent ? (
                                                            (() => {
                                                                const avatarUrl = toFullAvatarUrl(r.assigned_agent.avatar_url)
                                                                if (avatarUrl) {
                                                                    return (
                                                                        <img
                                                                            src={avatarUrl}
                                                                            alt={r.assigned_agent.name || 'Agent'}
                                                                            className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full object-cover border-2 border-white dark:border-gray-800"
                                                                        />
                                                                    )
                                                                }
                                                                return (
                                                                    <span className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[9px] font-semibold text-gray-700 dark:text-gray-200 border-2 border-white dark:border-gray-800">
                                                                        {getInitials(r.assigned_agent.name, 'A')}
                                                                    </span>
                                                                )
                                                            })()
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={shortSessionId(r.session_id)}>
                                                        {getVisitorDisplayName(r)}
                                                    </div>
                                                    {/* Mobile: show page title inline */}
                                                    <div className="md:hidden text-xs text-gray-500 dark:text-gray-400 truncate">
                                                        {r.current_page?.title || pageHost || r.came_from || (r.is_online ? 'Online' : '')}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        {websiteIds.length > 1 && (
                                            <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap">
                                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                                    {websiteLabels[r.website_id] || `#${r.website_id}`}
                                                </span>
                                            </td>
                                        )}
                                        <td className="hidden md:table-cell px-4 py-3">
                                            <div className="min-w-0 max-w-[200px]">
                                                <div className="text-sm text-gray-900 dark:text-white truncate">
                                                    {r.current_page?.title || pageHost || r.current_page?.url}
                                                </div>
                                                {pageHost ? (
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{pageHost}</div>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="hidden lg:table-cell px-4 py-3 whitespace-nowrap">
                                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[140px] block">{r.came_from || 'Direct'}</span>
                                        </td>
                                        <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-right">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{r.visits}</span>
                                        </td>
                                        <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-right">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{r.chats}</span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Right Drawer */}
            {selected ? (
                <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
                    <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl flex flex-col">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                                <UserAvatar
                                    seed={String(selected.sessionId || 'visitor')}
                                    bgColor={details?.visitor_avatar_color || rows.find((r) => r.website_id === selected.websiteId && r.session_id === selected.sessionId)?.visitor_avatar_color}
                                    className="w-10 h-10 flex-shrink-0"
                                    iconClassName="w-10 h-10"
                                    title={selected.sessionId}
                                />
                                <div className="min-w-0">
                                    <div className="text-sm text-gray-500 dark:text-gray-400">Visitor</div>
                                    <div className="text-lg font-semibold text-gray-900 dark:text-white truncate" title={selected.sessionId}>
                                        {details?.visitor_name || shortSessionId(selected.sessionId)}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={closeDrawer}
                                className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                                aria-label="Close"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {detailsLoading ? (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                            ) : detailsError ? (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                                    <p className="text-sm text-red-800 dark:text-red-300">{detailsError}</p>
                                </div>
                            ) : details ? (
                                <>
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-gray-600 dark:text-gray-400">
                                            Visits <span className="font-medium text-gray-900 dark:text-white">{details.visits}</span>
                                            <span className="mx-2">·</span>
                                            Chats <span className="font-medium text-gray-900 dark:text-white">{details.chats}</span>
                                        </div>
                                        {details.conversations?.some((c: any) => c.has_visitor_message) ? (
                                            <button
                                                onClick={() => {
                                                    const latest = details.conversations?.find((c: any) => c.has_visitor_message)
                                                    const cid = Number(latest?.conversation_id)
                                                    if (Number.isFinite(cid) && cid > 0) {
                                                        openConversation(latest?.short_id || null, cid)
                                                    }
                                                }}
                                                className="px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
                                            >
                                                Open conversation
                                            </button>
                                        ) : null}
                                    </div>

                                    <div className="space-y-2 text-sm">
                                        {details.device_info || details.browser_info ? (
                                            <div className="text-gray-700 dark:text-gray-300">
                                                {[details.device_info, details.browser_info].filter(Boolean).join(', ')}
                                            </div>
                                        ) : null}

                                        {details.came_from ? (
                                            <div className="text-gray-700 dark:text-gray-300">
                                                <span className="text-gray-500 dark:text-gray-400">Referrer</span>{' '}
                                                <span className="text-blue-600 dark:text-blue-400">{details.came_from}</span>
                                            </div>
                                        ) : null}
                                    </div>

                                    <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" open>
                                        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                            Browsing history
                                        </summary>
                                        <div className="px-4 pb-4 space-y-2">
                                            {details.page_views?.length ? (
                                                details.page_views.map((pv, idx) => (
                                                    <div key={idx} className="text-sm">
                                                        <div className="text-gray-900 dark:text-white truncate">{pv.title || safeHostFromUrl(pv.url) || pv.url}</div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{pv.url}</div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-sm text-gray-500 dark:text-gray-400">No browsing history</div>
                                            )}
                                        </div>
                                    </details>

                                    <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" open>
                                        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                            Conversations
                                        </summary>
                                        <div className="px-4 pb-4 space-y-2">
                                            {details.conversations?.length ? (
                                                details.conversations.map((c) => {
                                                    const hasMsgs = (c as any).has_visitor_message
                                                    return (
                                                        <button
                                                            key={c.conversation_id}
                                                            onClick={() => {
                                                                if (!hasMsgs) {
                                                                    setConfirmBotConv({ shortId: c.short_id || null, conversationId: Number(c.conversation_id) })
                                                                    return
                                                                }
                                                                openConversation(c.short_id || null, Number(c.conversation_id))
                                                            }}
                                                            className={`w-full text-left px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer ${!hasMsgs ? 'opacity-75' : ''}`}
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.title || (c.created_at ? new Date(c.created_at).toLocaleString() : 'Conversation')}</div>
                                                                <div className="flex items-center gap-1.5">
                                                                    {!hasMsgs && <span className="text-xs text-amber-500 dark:text-amber-400">Bot only</span>}
                                                                    <span className="text-xs text-gray-500 dark:text-gray-400">{c.status}</span>
                                                                </div>
                                                            </div>
                                                        </button>
                                                    )
                                                })
                                            ) : (
                                                <div className="text-sm text-gray-500 dark:text-gray-400">No conversations</div>
                                            )}
                                        </div>
                                    </details>
                                </>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Bot-only conversation confirm modal */}
            {confirmBotConv && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmBotConv(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Open bot-only conversation?</h3>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                            No messages have been sent by the visitor yet. Opening this will let you initiate the conversation from the agent side.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmBotConv(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    const { shortId, conversationId } = confirmBotConv
                                    setConfirmBotConv(null)
                                    openConversation(shortId, conversationId)
                                }}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                Open conversation
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
