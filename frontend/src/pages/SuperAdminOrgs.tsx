import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Building2, Users, Globe, RefreshCw, Search, X, Ban, CheckCircle2 } from 'lucide-react'
import { fetchOrganizations, updateOrganization, type OrgStats } from '@/services/admin'

export default function SuperAdminOrgs() {
    const [orgs, setOrgs] = useState<OrgStats[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [togglingId, setTogglingId] = useState<number | null>(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await fetchOrganizations()
            setOrgs(data)
        } catch (e: any) {
            setError(e?.message || 'Failed to load organizations')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    const filteredOrgs = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return orgs
        return orgs.filter(
            (org) => org.name.toLowerCase().includes(q) || org.slug.toLowerCase().includes(q)
        )
    }, [orgs, query])

    const handleToggleActive = async (org: OrgStats, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setTogglingId(org.id)
        try {
            const updated = await updateOrganization(org.id, { is_active: !org.is_active })
            setOrgs((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
        } catch (e: any) {
            setError(e?.message || 'Failed to update organization')
        } finally {
            setTogglingId(null)
        }
    }

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Organizations</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">All tenants on this platform</p>
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

            <div className="relative mb-4">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search organizations by name or slug…"
                    className="w-full rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-9 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {query && (
                    <button
                        onClick={() => setQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                        <X size={15} />
                    </button>
                )}
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !orgs.length ? (
                <div className="text-center py-16 text-slate-400">Loading…</div>
            ) : filteredOrgs.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <Building2 size={40} className="mx-auto mb-3 opacity-30" />
                    <p>{orgs.length === 0 ? 'No organizations yet. Invite the first customer to sign up.' : 'No organizations match your search.'}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredOrgs.map((org) => (
                        <Link
                            key={org.id}
                            to={`/superadmin/organizations/${org.id}`}
                            className="flex items-center gap-4 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{org.name}</span>
                                    <Badge
                                        variant={!org.is_active ? 'secondary' : !org.owner_verified ? 'outline' : 'default'}
                                        className={`shrink-0 text-xs ${!org.is_active ? '' :
                                                !org.owner_verified ? 'border-amber-400 text-amber-600 dark:text-amber-400' :
                                                    ''
                                            }`}
                                    >
                                        {!org.is_active ? 'Inactive' : !org.owner_verified ? 'Pending Verification' : 'Active'}
                                    </Badge>
                                    <Badge variant="outline" className="shrink-0 text-xs capitalize">{org.plan}</Badge>
                                </div>
                                <p className="text-xs text-slate-400 mt-0.5">/{org.slug}</p>
                            </div>
                            <div className="flex items-center gap-5 text-sm text-slate-500 dark:text-slate-400 shrink-0">
                                <span className="flex items-center gap-1.5">
                                    <Users size={14} />
                                    {org.member_count}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <Globe size={14} />
                                    {org.website_count}
                                </span>
                                <button
                                    onClick={(e) => handleToggleActive(org, e)}
                                    disabled={togglingId === org.id}
                                    title={org.is_active ? 'Suspend organization' : 'Reactivate organization'}
                                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${org.is_active
                                            ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                                            : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                                        }`}
                                >
                                    {org.is_active ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                                    {org.is_active ? 'Suspend' : 'Reactivate'}
                                </button>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}
