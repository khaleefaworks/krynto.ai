import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Building2, Users, Globe, RefreshCw } from 'lucide-react'

interface OrgStats {
    id: number
    name: string
    slug: string
    plan: string
    is_active: boolean
    owner_id: number | null
    member_count: number
    website_count: number
    conversation_count: number
}

export default function SuperAdminOrgs() {
    const [orgs, setOrgs] = useState<OrgStats[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiRequest<OrgStats[]>('/admin/organizations')
            setOrgs(data)
        } catch (e: any) {
            setError(e?.message || 'Failed to load organizations')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

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

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !orgs.length ? (
                <div className="text-center py-16 text-slate-400">Loading…</div>
            ) : orgs.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <Building2 size={40} className="mx-auto mb-3 opacity-30" />
                    <p>No organizations yet. Invite the first customer to sign up.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {orgs.map((org) => (
                        <Link
                            key={org.id}
                            to={`/superadmin/organizations/${org.id}`}
                            className="flex items-center gap-4 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{org.name}</span>
                                    <Badge variant={org.is_active ? 'default' : 'secondary'} className="shrink-0 text-xs">
                                        {org.is_active ? 'Active' : 'Inactive'}
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
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}
