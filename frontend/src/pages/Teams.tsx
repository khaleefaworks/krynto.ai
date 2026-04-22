import { useEffect, useMemo, useRef, useState } from 'react'
import { Users, HelpCircle } from 'lucide-react'

import { API_BASE } from '@/config/endpoints'
import UserAvatar from '@/components/UserAvatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AgentAvailability, TeamOverview, WebsiteTeamsOverview } from '@/services/teams'
import { teamsApi } from '@/services/teams'
import { addMessageHandler } from '@/services/agentSocket'

function toFullAvatarUrl(raw: string | null | undefined): string | null {
    const v = String(raw || '').trim()
    if (!v) return null
    if (v.startsWith('http://') || v.startsWith('https://')) return v
    return `${API_BASE}${v}`
}

function agentDisplayName(a: AgentAvailability): string {
    const name = String(a.name || '').trim()
    if (name) return name
    const email = String(a.email || '').trim()
    return email || `User ${a.id}`
}

function AvailabilityPill({ canReceive }: { canReceive: boolean }) {
    return (
        <div className="flex items-center gap-2 text-xs">
            <span
                className={
                    `inline-flex h-2.5 w-2.5 rounded-full ` +
                    (canReceive ? 'bg-emerald-500' : 'bg-red-500')
                }
                aria-hidden="true"
            />
            <span className={canReceive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                {canReceive ? 'Available' : 'Not Available'}
            </span>
        </div>
    )
}

function AgentRow({ agent }: { agent: AgentAvailability }) {
    const display = agentDisplayName(agent)
    const avatarUrl = toFullAvatarUrl(agent.avatar_url)

    return (
        <div className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={display}
                        className="h-7 w-7 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10"
                    />
                ) : (
                    <UserAvatar seed={String(agent.email || agent.id)} className="h-7 w-7" />
                )}
                <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{display}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{agent.email}</div>
                </div>
            </div>

            <div className="flex-shrink-0">
                <AvailabilityPill canReceive={Boolean(agent.can_receive_chats)} />
            </div>
        </div>
    )
}

function TeamBlock({ title, description, agents }: { title: string; description?: string | null; agents: AgentAvailability[] }) {
    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-950/40">
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{title}</div>
                    {description ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{description}</div>
                    ) : null}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {agents.length} agent{agents.length === 1 ? '' : 's'}
                </div>
            </div>
            {agents.length ? (
                <div className="divide-y divide-gray-200 dark:divide-gray-800">
                    {agents.map((a) => (
                        <AgentRow key={a.id} agent={a} />
                    ))}
                </div>
            ) : (
                <div className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">No agents</div>
            )}
        </div>
    )
}

function sortAgents(list: AgentAvailability[]): AgentAvailability[] {
    return [...(list || [])].sort((a, b) => agentDisplayName(a).localeCompare(agentDisplayName(b)))
}

export default function Teams() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [rows, setRows] = useState<WebsiteTeamsOverview[]>([])
    const [selectedWebsiteId, setSelectedWebsiteId] = useState<number | null>(null)
    const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

    const refresh = async () => {
        const data = await teamsApi.overview()
        setRows(Array.isArray(data) ? data : [])
    }
    refreshRef.current = refresh

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            setLoading(true)
            setError(null)
            try {
                await refresh()
            } catch (e: any) {
                if (cancelled) return
                setError(String(e?.message || 'Failed to load teams overview'))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [])

    // Listen for real-time availability changes via agent WebSocket
    useEffect(() => {
        const removeHandler = addMessageHandler((data: any) => {
            if (data?.type === 'availability_changed') {
                refreshRef.current().catch(() => { })
            }
        })
        return removeHandler
    }, [])

    const sorted = useMemo(() => {
        return [...rows].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    }, [rows])

    useEffect(() => {
        if (loading) return
        if (selectedWebsiteId != null && sorted.some((w) => Number(w.id) === Number(selectedWebsiteId))) return
        const first = sorted[0]
        setSelectedWebsiteId(first ? Number(first.id) : null)
    }, [loading, sorted, selectedWebsiteId])

    const selected = useMemo(() => {
        if (selectedWebsiteId == null) return null
        return sorted.find((w) => Number(w.id) === Number(selectedWebsiteId)) || null
    }, [sorted, selectedWebsiteId])

    return (
        <div className="bg-gray-50 dark:bg-gray-900 h-screen overflow-hidden">
            <div className="flex items-center justify-between mb-4 h-16 border-b dark:border-gray-700 px-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Teams</h1>
                        <a href="/docs/admin-guide/teams" target="_blank" rel="noreferrer" title="View teams guide" className="text-gray-400 hover:text-blue-500 transition-colors">
                            <HelpCircle className="w-4 h-4" />
                        </a>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Agent availability by website</p>
                </div>
            </div>

            {error ? (
                <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                    <CardHeader>
                        <CardTitle className="text-red-800 dark:text-red-300">Failed to load</CardTitle>
                        <CardDescription className="text-red-700/80 dark:text-red-300/80">{error}</CardDescription>
                    </CardHeader>
                </Card>
            ) : null}

            {loading ? (
                <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">Loading…</div>
            ) : null}

            {!loading && !error && sorted.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full mb-4">
                            <Users className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No websites</h2>
                        <p className="text-gray-500 dark:text-gray-400">No assigned websites found for your account.</p>
                    </div>
                </div>
            ) : null}

            {!loading && !error && sorted.length ? (
                <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-6rem)]">
                    <Card className="lg:col-span-4 xl:col-span-3 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Websites</CardTitle>
                            <CardDescription className="text-xs">Select a website to view teams</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="max-h-[calc(100vh-12rem)] overflow-auto divide-y divide-gray-200 dark:divide-gray-700">
                                {sorted.map((w) => {
                                    const available = Number(w.available_agents_count || 0)
                                    const assigned = Number(w.assigned_agents_count || 0)
                                    const active = Number(w.id) === Number(selectedWebsiteId)
                                    return (
                                        <button
                                            key={w.id}
                                            type="button"
                                            onClick={() => setSelectedWebsiteId(Number(w.id))}
                                            className={
                                                'w-full text-left px-4 py-3 transition-colors ' +
                                                (active
                                                    ? 'bg-blue-50 dark:bg-blue-900/20'
                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-900/30')
                                            }
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{w.name}</div>
                                                    {w.domain ? (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{w.domain}</div>
                                                    ) : null}
                                                </div>
                                                <div className="text-xs text-gray-600 dark:text-gray-300 flex-shrink-0">
                                                    {available}/{assigned}
                                                </div>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    <div className="lg:col-span-8 xl:col-span-9 overflow-hidden">
                        {selected ? (
                            (() => {
                                const available = Number(selected.available_agents_count || 0)
                                const assigned = Number(selected.assigned_agents_count || 0)
                                const teams: TeamOverview[] = (selected.teams || []).map((t) => ({
                                    ...t,
                                    agents: sortAgents(t.agents || []),
                                }))
                                const unassigned = sortAgents(selected.unassigned_agents || [])

                                return (
                                    <Card className="dark:bg-gray-800 dark:border-gray-700 h-full overflow-hidden">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-lg font-semibold text-gray-900 dark:text-white truncate">{selected.name}</div>
                                                    {selected.domain ? (
                                                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{selected.domain}</div>
                                                    ) : null}
                                                </div>
                                                <div className="text-sm text-gray-600 dark:text-gray-300 flex-shrink-0">
                                                    {available}/{assigned} available
                                                </div>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4 overflow-auto max-h-[calc(100vh-12rem)]">
                                            {assigned === 0 ? (
                                                <div className="text-sm text-gray-500 dark:text-gray-400">No agents assigned to this website.</div>
                                            ) : null}

                                            {teams.map((t) => (
                                                <TeamBlock
                                                    key={t.id}
                                                    title={t.name}
                                                    description={t.description}
                                                    agents={t.agents || []}
                                                />
                                            ))}

                                            <TeamBlock
                                                title="Unassigned"
                                                description="Assigned to this website but not in a team"
                                                agents={unassigned}
                                            />
                                        </CardContent>
                                    </Card>
                                )
                            })()
                        ) : (
                            <Card className="dark:bg-gray-800 dark:border-gray-700 h-full">
                                <CardHeader>
                                    <CardTitle className="text-base">Select a website</CardTitle>
                                    <CardDescription>Choose a website on the left to view teams and availability.</CardDescription>
                                </CardHeader>
                            </Card>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    )
}
