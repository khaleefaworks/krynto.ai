import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'
import type { CustomerContact, CustomerContactDetails } from '@/services/customers'
import { fetchContactDetails, fetchContacts } from '@/services/customers'

function formatDate(value: string | null): string {
    if (!value) return '-'
    try {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) return '-'
        return d.toLocaleDateString()
    } catch {
        return '-'
    }
}

export default function CustomersContacts() {
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [rows, setRows] = useState<CustomerContact[]>([])
    const [query, setQuery] = useState('')

    const [selected, setSelected] = useState<{ websiteId: number; contactKey: string } | null>(null)
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [detailsError, setDetailsError] = useState<string | null>(null)
    const [details, setDetails] = useState<CustomerContactDetails | null>(null)

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            try {
                setLoading(true)
                setError(null)
                const data = await fetchContacts({ limit: 200 })
                if (!cancelled) setRows(Array.isArray(data) ? data : [])
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Failed to load contacts')
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
            if (!selected) return
            try {
                setDetailsLoading(true)
                setDetailsError(null)
                setDetails(null)
                const data = await fetchContactDetails({
                    contactKey: selected.contactKey,
                    websiteId: selected.websiteId,
                })
                if (!cancelled) setDetails(data)
            } catch (e: any) {
                if (!cancelled) setDetailsError(e?.message || 'Failed to load contact details')
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

    const initials = (name: string | null, email: string | null, phone: string | null) => {
        const base = (name || '').trim()
        if (base) {
            const parts = base.split(/\s+/).filter(Boolean)
            return parts.slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || 'C'
        }
        const seed = (email || phone || 'C').trim()
        return seed.slice(0, 2).toUpperCase() || 'C'
    }

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return rows
        return rows.filter((r) => {
            const name = (r.name || '').toLowerCase()
            const email = (r.email || '').toLowerCase()
            const phone = (r.phone || '').toLowerCase()
            return name.includes(q) || email.includes(q) || phone.includes(q)
        })
    }, [rows, query])

    if (loading) {
        return (
            <div className="p-8">
                <div className="flex items-center justify-center h-64">
                    <div className="text-gray-500 dark:text-gray-400">Loading contacts...</div>
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
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Contacts</h1>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                    Number of contacts <span className="font-medium text-gray-900 dark:text-white">{filtered.length}</span>
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
                    <div className="text-gray-600 dark:text-gray-400">No contacts found</div>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Phone</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tags</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last update</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filtered.map((r, idx) => (
                                <tr
                                    key={`${r.website_id}:${r.contact_key || r.email || r.phone || idx}`}
                                    onClick={() => setSelected({ websiteId: r.website_id, contactKey: r.contact_key })}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">{r.name || '-'}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-700 dark:text-gray-300">{r.email || '-'}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-700 dark:text-gray-300">{r.phone || '-'}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        {r.tags?.length ? (
                                            <div className="flex flex-wrap gap-2">
                                                {r.tags.map((t) => (
                                                    <Badge key={t.name} variant="secondary">{t.name}</Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-sm text-gray-500 dark:text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <span className="text-sm text-gray-700 dark:text-gray-300">{formatDate(r.last_update)}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Right Drawer */}
            {selected ? (
                <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
                    <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl flex flex-col">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-200">
                                    {initials(details?.name || null, details?.email || null, details?.phone || null)}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-lg font-semibold text-gray-900 dark:text-white truncate">{details?.name || 'Contact'}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        Visits <span className="font-medium text-gray-900 dark:text-white">{details?.visits ?? '-'}</span>
                                        <span className="mx-2">·</span>
                                        Chats <span className="font-medium text-gray-900 dark:text-white">{details?.chats ?? '-'}</span>
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
                                    <div className="space-y-2 text-sm">
                                        {details.email ? (
                                            <div className="text-gray-700 dark:text-gray-300">{details.email}</div>
                                        ) : (
                                            <div className="text-gray-500 dark:text-gray-400">Fill in visitor's email</div>
                                        )}
                                        {details.phone ? (
                                            <div className="text-gray-700 dark:text-gray-300">{details.phone}</div>
                                        ) : (
                                            <div className="text-gray-500 dark:text-gray-400">Fill in visitor's phone number</div>
                                        )}
                                    </div>

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

                                    <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                            Contact tags
                                        </summary>
                                        <div className="px-4 pb-4">
                                            {details.tags?.length ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {details.tags.map((t) => (
                                                        <Badge key={t.name} variant="secondary">{t.name}</Badge>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-sm text-gray-500 dark:text-gray-400">No tags</div>
                                            )}
                                        </div>
                                    </details>

                                    <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                            Contact information
                                        </summary>
                                        <div className="px-4 pb-4 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                            <div>Email: {details.email || '-'}</div>
                                            <div>Phone: {details.phone || '-'}</div>
                                            <div>Last update: {formatDate(details.last_update)}</div>
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
