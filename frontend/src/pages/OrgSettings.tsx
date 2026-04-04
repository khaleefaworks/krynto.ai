import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isOrgOwner } from '@/lib/roles'
import { Building2, Check, Users, Globe, Pencil, X, Sparkles } from 'lucide-react'
import type { Organization } from '@/types/index'

interface OrgStats {
    agents: number
    websites: number
}

export default function OrgSettings() {
    const { user, organization, setOrganization } = useAppStore()
    const [name, setName] = useState(organization?.name || '')
    const [loading, setLoading] = useState(!organization)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const [editing, setEditing] = useState(false)
    const [stats, setStats] = useState<OrgStats | null>(null)

    useEffect(() => {
        const loadOrg = async () => {
            try {
                let org = organization
                if (!org) {
                    org = await apiRequest<Organization>('/organization')
                    setOrganization(org)
                }
                setName(org.name)
            } catch (e: any) {
                setError(e?.message || 'Failed to load')
            } finally {
                setLoading(false)
            }
        }
        loadOrg()
    }, [])

    useEffect(() => {
        // Fetch lightweight stats in parallel
        const fetchStats = async () => {
            try {
                const [members, websites] = await Promise.allSettled([
                    apiRequest<{ id: number }[]>('/organization/members'),
                    apiRequest<{ id: number }[]>('/websites'),
                ])
                setStats({
                    agents: members.status === 'fulfilled' ? members.value.length : 0,
                    websites: websites.status === 'fulfilled' ? websites.value.length : 0,
                })
            } catch {
                // non-critical
            }
        }
        fetchStats()
    }, [])

    const handleSave = async () => {
        if (!name.trim()) return
        setSaving(true)
        setError(null)
        setSaved(false)
        try {
            const updated = await apiRequest<Organization>('/organization', {
                method: 'PATCH',
                body: JSON.stringify({ name: name.trim() }),
            })
            setOrganization(updated)
            setName(updated.name)
            setSaved(true)
            setEditing(false)
            setTimeout(() => setSaved(false), 2000)
        } catch (e: any) {
            setError(e?.message || 'Save failed')
        } finally {
            setSaving(false)
        }
    }

    const cancelEdit = () => {
        setName(organization?.name || '')
        setEditing(false)
        setError(null)
    }

    if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>

    const canEdit = isOrgOwner(user)
    const planLabel = organization?.plan ? organization.plan.charAt(0).toUpperCase() + organization.plan.slice(1) : 'Free'

    const statCards = [
        {
            icon: Users,
            label: 'Team Members',
            value: stats ? stats.agents : '—',
            sub: 'Agents & managers',
        },
        {
            icon: Globe,
            label: 'Websites',
            value: stats ? stats.websites : '—',
            sub: 'Active chat sites',
        },
        {
            icon: Sparkles,
            label: 'Plan',
            value: planLabel,
            sub: organization?.is_active ? 'Active' : 'Inactive',
        },
    ]

    const orgInitials = organization?.name
        ?.split(' ')
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?'

    return (
        <div className="flex flex-col h-full">
            {/* Top header bar — matches PersonalSettings */}
            <div className="h-16 flex items-center border-b dark:border-gray-700 px-6 flex-shrink-0">
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Organization</h1>
            </div>

            <div className="flex-1 overflow-auto py-8">
                <div className="max-w-xl w-full mx-auto px-6 space-y-8">

                    {error && (
                        <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            {error}
                        </div>
                    )}

                    {/* ─── Org Avatar + Identity ─── */}
                    <div className="flex flex-col items-center text-center">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center ring-4 ring-gray-100 dark:ring-gray-700 mb-4">
                            <span className="text-2xl font-bold text-white">{orgInitials}</span>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{organization?.name}</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Organization</p>
                        <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${organization?.is_active
                            ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                            }`}>
                            {organization?.is_active ? 'Active' : 'Inactive'} · {planLabel} Plan
                        </span>
                    </div>

                    {/* ─── Stats ─── */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Overview</h3>
                        <div className="grid grid-cols-3 gap-3">
                            {statCards.map(({ icon: Icon, label, value, sub }) => (
                                <div
                                    key={label}
                                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 px-4 py-4 flex flex-col gap-1"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
                                    </div>
                                    <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
                                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{sub}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ─── Organization Details ─── */}
                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Organization Details</h3>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800/50">

                            {/* Organization Name */}
                            <div className="px-4 py-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Organization Name</p>
                                        {editing ? (
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <Input
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEdit() }}
                                                    autoFocus
                                                    maxLength={255}
                                                    className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                />
                                                <Button onClick={handleSave} disabled={saving || !name.trim() || name.trim() === organization?.name} size="sm" className="shrink-0">
                                                    {saving ? 'Saving…' : saved ? <Check size={14} /> : 'Save'}
                                                </Button>
                                                <Button onClick={cancelEdit} variant="ghost" size="sm" className="shrink-0 text-gray-400">
                                                    <X size={14} />
                                                </Button>
                                            </div>
                                        ) : (
                                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{organization?.name || '—'}</p>
                                        )}
                                        {!canEdit && !editing && (
                                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Only the Organization Owner can change this.</p>
                                        )}
                                    </div>
                                    {canEdit && !editing && (
                                        <button
                                            onClick={() => setEditing(true)}
                                            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium shrink-0"
                                        >
                                            <Pencil size={12} />
                                            Edit
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Plan */}
                            <div className="flex items-center gap-3 px-4 py-3">
                                <Sparkles className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                <span className="text-sm text-gray-500 dark:text-gray-400 w-20">Plan</span>
                                <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">{planLabel}</span>
                            </div>

                            {/* Org ID */}
                            <div className="flex items-center gap-3 px-4 py-3">
                                <Building2 className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                <span className="text-sm text-gray-500 dark:text-gray-400 w-20">Org ID</span>
                                <span className="text-sm font-mono text-gray-900 dark:text-white">{organization?.id ?? '—'}</span>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    )
}
