import { useEffect, useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { apiRequest } from '@/services/api'
import { agentAssignmentsApi, type Agent } from '@/services/agentAssignments'
import { Plus, X, Trash2, Users, UserPlus, Shield, Search } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────
interface WebsiteTeam {
    id: number
    website_id: number
    name: string
    description?: string | null
    member_count: number
}

interface WebsiteAgent {
    id: number
    email: string
    name?: string | null
    role?: string
    is_active?: boolean
    assigned_at?: string | null
}

interface TeamMembersResponse {
    team_id: number
    user_ids: number[]
}

type TeamPanel =
    | { kind: 'closed' }
    | { kind: 'create' }
    | { kind: 'edit'; team: WebsiteTeam }

type AgentPanel =
    | { kind: 'closed' }
    | { kind: 'add' }

export default function WebsiteTeamsTab({ websiteId }: { websiteId: number }) {
    // ─── Agent state ──────────────────────────────────────
    const [websiteAgents, setWebsiteAgents] = useState<WebsiteAgent[]>([])
    const [agentsLoading, setAgentsLoading] = useState(false)
    const [agentsError, setAgentsError] = useState<string | null>(null)
    const [allAgents, setAllAgents] = useState<Agent[]>([])
    const [allAgentsLoading, setAllAgentsLoading] = useState(false)
    const [assigningAgentId, setAssigningAgentId] = useState<number | null>(null)
    const [unassigningAgentId, setUnassigningAgentId] = useState<number | null>(null)

    // ─── Team state ───────────────────────────────────────
    const [teams, setTeams] = useState<WebsiteTeam[]>([])
    const [teamsLoading, setTeamsLoading] = useState(false)
    const [teamsError, setTeamsError] = useState<string | null>(null)

    // ─── Panels ───────────────────────────────────────────
    const [agentPanel, setAgentPanel] = useState<AgentPanel>({ kind: 'closed' })
    const [teamPanel, setTeamPanel] = useState<TeamPanel>({ kind: 'closed' })
    const [agentSearch, setAgentSearch] = useState('')

    // ─── Team create/edit form ────────────────────────────
    const [formName, setFormName] = useState('')
    const [formDescription, setFormDescription] = useState('')
    const [teamSaving, setTeamSaving] = useState(false)
    const [teamDeleting, setTeamDeleting] = useState(false)

    // ─── Members (in team edit panel) ─────────────────────
    const [memberIds, setMemberIds] = useState<number[]>([])
    const [membersLoading, setMembersLoading] = useState(false)
    const [membersSaving, setMembersSaving] = useState(false)
    const membersSeq = useRef(0)

    const [error, setError] = useState<string | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)

    // ─── Data loading ─────────────────────────────────────
    const loadAgents = useCallback(async () => {
        setAgentsLoading(true)
        setAgentsError(null)
        try {
            const data = await apiRequest<WebsiteAgent[]>(`/agent-assignments/website/${websiteId}/agents`)
            setWebsiteAgents(Array.isArray(data) ? data : [])
        } catch (e: any) {
            setAgentsError(e?.message || 'Failed to load agents')
        } finally {
            setAgentsLoading(false)
        }
    }, [websiteId])

    const loadAllAgents = useCallback(async () => {
        setAllAgentsLoading(true)
        try {
            const data = await agentAssignmentsApi.listAgents()
            setAllAgents(Array.isArray(data) ? data : [])
        } catch {
            // silent - shown in panel
        } finally {
            setAllAgentsLoading(false)
        }
    }, [])

    const loadTeams = useCallback(async () => {
        setTeamsLoading(true)
        setTeamsError(null)
        try {
            const data = await apiRequest<WebsiteTeam[]>(`/websites/${websiteId}/teams`)
            setTeams(Array.isArray(data) ? data : [])
        } catch (e: any) {
            setTeamsError(e?.message || 'Failed to load teams')
        } finally {
            setTeamsLoading(false)
        }
    }, [websiteId])

    useEffect(() => {
        loadAgents()
        loadTeams()
        loadAllAgents()
    }, [loadAgents, loadTeams, loadAllAgents])

    // ─── Agent panel helpers ──────────────────────────────
    const openAgentPanel = () => {
        setAgentSearch('')
        setError(null)
        loadAllAgents()
        setAgentPanel({ kind: 'add' })
    }
    const closeAgentPanel = () => setAgentPanel({ kind: 'closed' })

    const handleAssign = async (agentId: number) => {
        setAssigningAgentId(agentId)
        setError(null)
        try {
            await agentAssignmentsApi.assignAgentToWebsite(agentId, websiteId)
            await loadAgents()
        } catch (e: any) {
            setError(e?.message || 'Failed to assign agent')
        } finally {
            setAssigningAgentId(null)
        }
    }

    const handleUnassign = async (agentId: number) => {
        setUnassigningAgentId(agentId)
        try {
            await agentAssignmentsApi.unassignAgentFromWebsite(agentId, websiteId)
            await loadAgents()
            // Remove from any open team member selection
            setMemberIds(prev => prev.filter(id => id !== agentId))
        } catch (e: any) {
            setAgentsError(e?.message || 'Failed to unassign agent')
        } finally {
            setUnassigningAgentId(null)
        }
    }

    // Available agents (not yet assigned)
    const availableAgents = (() => {
        const ids = new Set(websiteAgents.map(a => a.id))
        return allAgents
            .filter(u => !ids.has(u.id))
            .filter(u => {
                const role = String((u as any).role || '').toLowerCase()
                return !role || role === 'agent' || role === 'manager' || role === 'owner' || role === 'system_manager'
            })
            .filter(u => {
                if (!agentSearch.trim()) return true
                const q = agentSearch.toLowerCase()
                return u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)
            })
    })()

    // ─── Team panel helpers ───────────────────────────────
    const openTeamCreate = () => {
        setFormName('')
        setFormDescription('')
        setError(null)
        setTeamPanel({ kind: 'create' })
    }

    const openTeamEdit = async (team: WebsiteTeam) => {
        setFormName(team.name)
        setFormDescription(team.description || '')
        setError(null)
        setMemberIds([])
        setTeamPanel({ kind: 'edit', team })
        // Load members
        const seq = ++membersSeq.current
        setMembersLoading(true)
        try {
            const data = await apiRequest<TeamMembersResponse>(`/websites/${websiteId}/teams/${team.id}/members`)
            if (seq !== membersSeq.current) return
            setMemberIds(Array.isArray(data?.user_ids) ? data.user_ids.map(Number).filter(Number.isFinite) : [])
        } catch (e: any) {
            if (seq === membersSeq.current) setError(e?.message || 'Failed to load members')
        } finally {
            if (seq === membersSeq.current) setMembersLoading(false)
        }
    }

    const closeTeamPanel = () => setTeamPanel({ kind: 'closed' })

    const handleSaveTeam = async () => {
        const name = formName.trim()
        if (!name) { setError('Team name is required.'); return }

        setTeamSaving(true)
        setError(null)
        try {
            if (teamPanel.kind === 'create') {
                await apiRequest(`/websites/${websiteId}/teams`, {
                    method: 'POST',
                    body: JSON.stringify({ name, description: formDescription.trim() || null }),
                })
            } else if (teamPanel.kind === 'edit') {
                // Save members
                await apiRequest(`/websites/${websiteId}/teams/${teamPanel.team.id}/members`, {
                    method: 'PUT',
                    body: JSON.stringify({ user_ids: memberIds }),
                })
            }
            closeTeamPanel()
            await loadTeams()
            setSuccessMessage(teamPanel.kind === 'create' ? 'Team created' : 'Team updated')
            setTimeout(() => setSuccessMessage(null), 2000)
        } catch (e: any) {
            setError(e?.message || 'Failed to save team')
        } finally {
            setTeamSaving(false)
        }
    }

    const handleDeleteTeam = async () => {
        if (teamPanel.kind !== 'edit') return
        if (!confirm('Delete this team? This cannot be undone.')) return
        setTeamDeleting(true)
        setError(null)
        try {
            await apiRequest(`/websites/${websiteId}/teams/${teamPanel.team.id}`, { method: 'DELETE' })
            closeTeamPanel()
            await loadTeams()
        } catch (e: any) {
            setError(e?.message || 'Failed to delete team')
        } finally {
            setTeamDeleting(false)
        }
    }

    // Close panels on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (teamPanel.kind !== 'closed') closeTeamPanel()
            else if (agentPanel.kind !== 'closed') closeAgentPanel()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [teamPanel.kind, agentPanel.kind])

    const anyPanelOpen = teamPanel.kind !== 'closed' || agentPanel.kind !== 'closed'

    // ─── Role badge helper ────────────────────────────────
    const roleBadge = (role?: string) => {
        if (!role) return null
        const r = role.toLowerCase()
        const colors =
            r === 'system_manager' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                r === 'owner' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                    r === 'manager' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                        'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
        return (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${colors}`}>
                {role.replace('_', ' ')}
            </span>
        )
    }

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            {/* Scrollable content area */}
            <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
                {/* Success message */}
                {successMessage && !anyPanelOpen && (
                    <div className="p-3 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                        {successMessage}
                    </div>
                )}

                {/* ─── Website Agents section ──────────────────── */}
                <section>
                    <div className="flex items-center justify-between mb-1">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Shield className="h-4 w-4 text-gray-400" />
                            Website Agents
                        </h2>
                        <Button size="sm" onClick={openAgentPanel}>
                            <UserPlus className="h-4 w-4 mr-1.5" />
                            Add Agent
                        </Button>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Agents assigned to this website can handle conversations and be added to teams.
                    </p>

                    {agentsError && !anyPanelOpen && (
                        <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            {agentsError}
                        </div>
                    )}

                    {agentsLoading ? (
                        <div className="py-10 text-center text-sm text-gray-400">Loading agents…</div>
                    ) : websiteAgents.length === 0 ? (
                        <div className="py-10 text-center">
                            <UserPlus className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No agents assigned</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Add agents so they can handle this website's conversations.</p>
                            <Button size="sm" variant="outline" onClick={openAgentPanel}>
                                <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add Agent
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Agent</th>
                                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-36">Role</th>
                                        <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-16"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {websiteAgents.map(a => (
                                        <tr key={a.id} className="bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                                                        {(a.name || a.email).charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.name || a.email}</p>
                                                        {a.name && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{a.email}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {roleBadge(a.role)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    type="button"
                                                    disabled={unassigningAgentId === a.id}
                                                    onClick={() => handleUnassign(a.id)}
                                                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                                                    title="Remove from website"
                                                >
                                                    {unassigningAgentId === a.id ? (
                                                        <span className="text-xs">…</span>
                                                    ) : (
                                                        <X className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* Divider */}
                <div className="border-t border-gray-200 dark:border-gray-700" />

                {/* ─── Teams section ───────────────────────────── */}
                <section>
                    <div className="flex items-center justify-between mb-1">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Users className="h-4 w-4 text-gray-400" />
                            Teams
                        </h2>
                        <Button size="sm" onClick={openTeamCreate}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            New Team
                        </Button>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Organize agents into teams for routing and management.
                    </p>

                    {teamsError && !anyPanelOpen && (
                        <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            {teamsError}
                        </div>
                    )}

                    {teamsLoading ? (
                        <div className="py-10 text-center text-sm text-gray-400">Loading teams…</div>
                    ) : teams.length === 0 ? (
                        <div className="py-10 text-center">
                            <Users className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No teams yet</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Create teams to group agents for chat routing.</p>
                            <Button size="sm" variant="outline" onClick={openTeamCreate}>
                                <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Team
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Team</th>
                                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Description</th>
                                        <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-24">Members</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {teams.map(t => (
                                        <tr
                                            key={t.id}
                                            onClick={() => openTeamEdit(t)}
                                            className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white flex-shrink-0">
                                                        <Users className="h-3.5 w-3.5" />
                                                    </div>
                                                    <span className="font-medium text-gray-900 dark:text-white">{t.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-0">
                                                <span className="block truncate">{t.description || '—'}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                                                    <Users className="h-3 w-3" />
                                                    {t.member_count}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>

            {/* ─── Add Agent slide-over ────────────────────── */}
            {agentPanel.kind !== 'closed' && (
                <>
                    <div className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10" onClick={closeAgentPanel} />
                    <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200">
                        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Add Agent</h3>
                            <button
                                type="button"
                                onClick={closeAgentPanel}
                                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="px-5 pt-4 pb-3 flex-shrink-0">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    value={agentSearch}
                                    onChange={e => setAgentSearch(e.target.value)}
                                    placeholder="Search agents…"
                                    className="pl-9 dark:bg-gray-800 dark:border-gray-700"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto px-5 pb-5">
                            {error && (
                                <div className="mb-3 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                                    {error}
                                </div>
                            )}

                            {allAgentsLoading ? (
                                <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
                            ) : availableAgents.length === 0 ? (
                                <div className="py-10 text-center">
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        {agentSearch.trim() ? `No agents matching "${agentSearch}"` : 'All agents are already assigned.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {availableAgents.map(u => (
                                        <div
                                            key={u.id}
                                            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                                                    {(u.name || u.email).charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{u.name || u.email}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        {u.name && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>}
                                                        {roleBadge((u as any).role)}
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={assigningAgentId === u.id}
                                                onClick={() => handleAssign(u.id)}
                                                className="h-8 text-xs flex-shrink-0"
                                            >
                                                {assigningAgentId === u.id ? '…' : 'Assign'}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* ─── Team create/edit slide-over ─────────────── */}
            {teamPanel.kind !== 'closed' && (
                <>
                    <div className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10" onClick={closeTeamPanel} />
                    <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200">
                        {/* Panel header */}
                        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                {teamPanel.kind === 'create' ? 'New Team' : teamPanel.team.name}
                            </h3>
                            <button
                                type="button"
                                onClick={closeTeamPanel}
                                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Panel body */}
                        <div className="flex-1 overflow-auto p-5 space-y-5">
                            {error && (
                                <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                                    {error}
                                </div>
                            )}

                            {/* Name */}
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Team name</label>
                                <Input
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    placeholder="e.g. Support, Sales"
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                    autoFocus
                                    disabled={teamPanel.kind === 'edit'}
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Description</label>
                                <Textarea
                                    value={formDescription}
                                    onChange={e => setFormDescription(e.target.value)}
                                    placeholder="What is this team responsible for?"
                                    rows={2}
                                    className="dark:bg-gray-800 dark:border-gray-700 resize-none"
                                    disabled={teamPanel.kind === 'edit'}
                                />
                            </div>

                            {/* Members section (only for edit) */}
                            {teamPanel.kind === 'edit' && (
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Members
                                        </label>
                                        <span className="text-xs text-gray-400">
                                            {memberIds.length} selected
                                        </span>
                                    </div>

                                    {membersLoading ? (
                                        <div className="py-6 text-center text-sm text-gray-400">Loading members…</div>
                                    ) : websiteAgents.length === 0 ? (
                                        <div className="py-6 text-center text-sm text-gray-400">
                                            Assign agents to this website first to add team members.
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {websiteAgents.map(a => {
                                                const checked = memberIds.includes(a.id)
                                                return (
                                                    <label
                                                        key={a.id}
                                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${checked
                                                            ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
                                                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                                                            }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={membersLoading || membersSaving}
                                                            onChange={e => {
                                                                setMemberIds(prev =>
                                                                    e.target.checked
                                                                        ? [...new Set([...prev, a.id])]
                                                                        : prev.filter(id => id !== a.id)
                                                                )
                                                            }}
                                                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600"
                                                        />
                                                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                                            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
                                                                {(a.name || a.email).charAt(0).toUpperCase()}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                                                                    {a.name || a.email}
                                                                </p>
                                                                {a.name && (
                                                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{a.email}</p>
                                                                )}
                                                            </div>
                                                            {roleBadge(a.role)}
                                                        </div>
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Panel footer */}
                        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 flex-shrink-0">
                            <div className="flex items-center justify-between">
                                {teamPanel.kind === 'edit' ? (
                                    <button
                                        type="button"
                                        onClick={handleDeleteTeam}
                                        disabled={teamDeleting}
                                        className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        {teamDeleting ? 'Deleting…' : 'Delete'}
                                    </button>
                                ) : (
                                    <span />
                                )}
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={closeTeamPanel}>Cancel</Button>
                                    <Button
                                        size="sm"
                                        onClick={handleSaveTeam}
                                        disabled={teamSaving || !formName.trim()}
                                    >
                                        {teamSaving ? 'Saving…' : teamPanel.kind === 'create' ? 'Create Team' : 'Save Members'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
