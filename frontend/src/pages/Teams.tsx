import { useEffect, useMemo, useState } from 'react'
import { Users } from 'lucide-react'

import { API_BASE } from '@/config/endpoints'
import UserAvatar from '@/components/UserAvatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AgentAvailability, TeamOverview, WebsiteTeamsOverview } from '@/services/teams'
import { teamsApi } from '@/services/teams'

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
        <div className="flex items-center gap-2">
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
        <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={display}
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10"
                    />
                ) : (
                    <UserAvatar seed={String(agent.email || agent.id)} className="h-8 w-8" />
                )}
                <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{display}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{agent.email}</div>
                </div>
            </div>

            <div className="flex-shrink-0 text-xs">
                <AvailabilityPill canReceive={Boolean(agent.can_receive_chats)} />
            </div>
        </div>
    )
}

function TeamBlock({ title, description, agents }: { title: string; description?: string | null; agents: AgentAvailability[] }) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{title}</div>
                    {description ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{description}</div>
                    ) : null}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{agents.length} agent{agents.length === 1 ? '' : 's'}</div>
            </div>

            {agents.length ? (
                <div className="grid gap-2">
                    {agents.map((a) => (
                        <AgentRow key={a.id} agent={a} />
                    ))}
                </div>
            ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No agents</div>
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

    const refresh = async () => {
        const data = await teamsApi.overview()
        setRows(Array.isArray(data) ? data : [])
    }

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

    const sorted = useMemo(() => {
        return [...rows].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    }, [rows])

    return (
        <div className="p-8 overflow-y-auto bg-gray-50 dark:bg-gray-900 h-screen">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Teams</h1>
                    <p className="text-gray-600 dark:text-gray-400">Agent availability by website</p>
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
                <div className="grid gap-4">
                    {sorted.map((w) => {
                        const available = Number(w.available_agents_count || 0)
                        const assigned = Number(w.assigned_agents_count || 0)

                        const teams: TeamOverview[] = (w.teams || []).map((t) => ({
                            ...t,
                            agents: sortAgents(t.agents || []),
                        }))

                        const unassigned = sortAgents(w.unassigned_agents || [])

                        return (
                            <Card key={w.id} className="dark:bg-gray-800 dark:border-gray-700">
                                <CardHeader>
                                    <CardTitle className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-lg font-semibold text-gray-900 dark:text-white truncate">{w.name}</div>
                                            {w.domain ? (
                                                <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{w.domain}</div>
                                            ) : null}
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 flex-shrink-0">
                                            {available}/{assigned} available
                                        </div>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-6">
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
                                        description="Agents assigned to this website but not in a team"
                                        agents={unassigned}
                                    />

                                    {assigned === 0 ? (
                                        <div className="text-sm text-gray-500 dark:text-gray-400">No agents assigned to this website.</div>
                                    ) : null}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}
