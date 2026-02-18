import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import type { CustomerVisitor, CustomerVisitorDetails } from '@/services/customers'
import { fetchVisitorDetails, fetchVisitors } from '@/services/customers'
import { addMessageHandler, connectAgentSocket } from '@/services/agentSocket'
import { isAdmin } from '@/lib/roles'
import { websitesApi } from '@/services/websites'
import { agentAssignmentsApi } from '@/services/agentAssignments'

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

export default function CustomersVisitors() {
    const navigate = useNavigate()
    const user = useAppStore((s) => s.user)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [rows, setRows] = useState<CustomerVisitor[]>([])
    const [query, setQuery] = useState('')

    const [websiteLabels, setWebsiteLabels] = useState<Record<number, string>>({})

    const [selected, setSelected] = useState<{ websiteId: number; sessionId: string } | null>(null)
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [detailsError, setDetailsError] = useState<string | null>(null)
    const [details, setDetails] = useState<CustomerVisitorDetails | null>(null)

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
                    for (const s of (Array.isArray(sites) ? sites : [])) {
                        const id = Number((s as any).id)
                        if (!Number.isFinite(id)) continue
                        const domain = String((s as any).domain || '').trim()
                        const name = String((s as any).name || '').trim()
                        next[id] = domain || name || `#${id}`
                    }
                    setWebsiteLabels(next)
                } else {
                    const sites = await agentAssignmentsApi.getAgentWebsites(user.id)
                    if (cancelled) return
                    const next: Record<number, string> = {}
                    for (const s of (Array.isArray(sites) ? sites : [])) {
                        const id = Number((s as any).id)
                        if (!Number.isFinite(id)) continue
                        const domain = String((s as any).domain || '').trim()
                        const name = String((s as any).name || '').trim()
                        next[id] = domain || name || `#${id}`
                    }
                    setWebsiteLabels(next)
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
                setDetailsLoading(true)
                setDetailsError(null)
                setDetails(null)
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

    const openConversation = (conversationId: number, sessionId: string) => {
        navigate(`/dashboard/chats/${encodeURIComponent(sessionId)}`, {
            state: { conversationId },
        })
        closeDrawer()
    }

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return rows
        return rows.filter((r) => {
            const pageHost = safeHostFromUrl(r.current_page?.url)
            const cameFrom = r.came_from || ''
            return (
                r.session_id.toLowerCase().includes(q) ||
                (r.current_page?.title || '').toLowerCase().includes(q) ||
                (pageHost || '').toLowerCase().includes(q) ||
                cameFrom.toLowerCase().includes(q)
            )
        })
    }, [rows, query])

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
        <div className="p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Visitors</h1>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                    Number of visitors <span className="font-medium text-gray-900 dark:text-white">{filtered.length}</span>
                </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
                <div className="relative w-full max-w-sm">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search..."
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                </div>
            </div>

            {filtered.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
                    <div className="text-gray-600 dark:text-gray-400">No visitors found</div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Visitor</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Website</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Online</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current page</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Came from</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Visits</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Chats</th>
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
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-2">
                                                    {r.visitor_initiated_chat ? (
                                                        <span
                                                            className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center"
                                                            title="Visitor initiated chat"
                                                        >
                                                            <MessageSquare className="w-4 h-4 text-white" />
                                                        </span>
                                                    ) : (
                                                        <span className="w-7 h-7" />
                                                    )}

                                                    <div className="relative">
                                                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-700 dark:text-gray-200">
                                                            {getInitials(null, (shortSessionId(r.session_id).charAt(0) || '?').toUpperCase())}
                                                        </div>

                                                        {r.is_online ? (
                                                            <span className="absolute -left-0.5 -top-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-800" />
                                                        ) : null}

                                                        {r.agent_joined && r.assigned_agent ? (
                                                            <span className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[10px] font-semibold text-gray-700 dark:text-gray-200 border-2 border-white dark:border-gray-800">
                                                                {getInitials(r.assigned_agent.name, 'A')}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="min-w-0">
                                                    <div
                                                        className="text-sm font-medium text-gray-900 dark:text-white truncate"
                                                        title={r.session_id}
                                                    >
                                                        {shortSessionId(r.session_id)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">
                                                {websiteLabels[r.website_id] || `#${r.website_id}`}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{formatOnlineSeconds(r.online_seconds)}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="min-w-0">
                                                <div className="text-sm text-gray-900 dark:text-white truncate">
                                                    {r.current_page?.title || pageHost || r.current_page?.url}
                                                </div>
                                                {pageHost ? (
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{pageHost}</div>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{r.came_from || '-'}</span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{r.visits}</span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
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
                            <div className="min-w-0">
                                <div className="text-sm text-gray-500 dark:text-gray-400">Visitor</div>
                                <div
                                    className="text-lg font-semibold text-gray-900 dark:text-white truncate"
                                    title={selected.sessionId}
                                >
                                    {shortSessionId(selected.sessionId)}
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
                                        {details.conversations?.length ? (
                                            <button
                                                onClick={() => {
                                                    const latest = details.conversations?.[0]
                                                    const cid = Number(latest?.conversation_id)
                                                    if (Number.isFinite(cid) && cid > 0) {
                                                        openConversation(cid, details.session_id)
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
                                                details.conversations.map((c) => (
                                                    <button
                                                        key={c.conversation_id}
                                                        onClick={() => openConversation(Number(c.conversation_id), c.session_id)}
                                                        className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-gray-200 dark:border-gray-700"
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.created_at ? new Date(c.created_at).toLocaleString() : 'Conversation'}</div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">{c.status}</div>
                                                        </div>
                                                    </button>
                                                ))
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
        </div>
    )
}
