import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Users, Globe, MessageSquare } from 'lucide-react'

interface OrgStats {
    id: number
    name: string
    slug: string
    plan: string
    is_active: boolean
    owner_verified: boolean
    owner_id: number | null
    member_count: number
    website_count: number
    conversation_count: number
}

const PLANS = ['free', 'pro', 'enterprise'] as const

export default function SuperAdminOrgDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [org, setOrg] = useState<OrgStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [plan, setPlan] = useState('')
    const [isActive, setIsActive] = useState(true)

    useEffect(() => {
        if (!id) return
        setLoading(true)
        apiRequest<OrgStats>(`/admin/organizations/${id}`)
            .then((data) => {
                setOrg(data)
                setPlan(data.plan)
                setIsActive(data.is_active)
            })
            .catch((e) => setError(e?.message || 'Failed to load'))
            .finally(() => setLoading(false))
    }, [id])

    const handleSave = async () => {
        if (!id) return
        setSaving(true)
        setError(null)
        try {
            const updated = await apiRequest<OrgStats>(`/admin/organizations/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ plan, is_active: isActive }),
            })
            setOrg(updated)
        } catch (e: any) {
            setError(e?.message || 'Save failed')
        } finally {
            setSaving(false)
        }
    }

    const changed = org && (plan !== org.plan || isActive !== org.is_active)

    if (loading) {
        return <div className="p-6 text-slate-400">Loading…</div>
    }

    if (!org) {
        return (
            <div className="p-6">
                <p className="text-red-500">{error || 'Organization not found'}</p>
                <Link to="/superadmin/organizations" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
                    ← Back to list
                </Link>
            </div>
        )
    }

    return (
        <div className="p-6 max-w-2xl mx-auto">
            <button
                onClick={() => navigate('/superadmin/organizations')}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 mb-5 transition-colors"
            >
                <ArrowLeft size={14} /> Back to Organizations
            </button>

            <div className="flex items-center gap-3 mb-6">
                <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{org.name}</h1>
                <Badge
                    variant={!org.is_active ? 'secondary' : !org.owner_verified ? 'outline' : 'default'}
                    className={!org.is_active ? '' : !org.owner_verified ? 'border-amber-400 text-amber-600 dark:text-amber-400' : ''}
                >
                    {!org.is_active ? 'Inactive' : !org.owner_verified ? 'Pending Verification' : 'Active'}
                </Badge>
                <Badge variant="outline" className="capitalize">{org.plan}</Badge>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                    { label: 'Members', value: org.member_count, icon: <Users size={16} /> },
                    { label: 'Websites', value: org.website_count, icon: <Globe size={16} /> },
                    { label: 'Conversations', value: org.conversation_count, icon: <MessageSquare size={16} /> },
                ].map(({ label, value, icon }) => (
                    <div key={label} className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-slate-400 mb-1">{icon}<span className="text-xs">{label}</span></div>
                        <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{value}</p>
                    </div>
                ))}
            </div>

            {/* Details */}
            <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y dark:divide-gray-700">
                <div className="px-5 py-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs text-slate-400 mb-0.5">Slug</p>
                        <p className="text-sm font-mono text-slate-700 dark:text-slate-200">/{org.slug}</p>
                    </div>
                </div>

                <div className="px-5 py-4">
                    <label className="text-xs text-slate-400 block mb-1.5">Plan</label>
                    <select
                        value={plan}
                        onChange={(e) => setPlan(e.target.value)}
                        className="w-full rounded-md border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {PLANS.map((p) => (
                            <option key={p} value={p} className="capitalize">{p}</option>
                        ))}
                    </select>
                </div>

                <div className="px-5 py-4 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Active</p>
                        <p className="text-xs text-slate-400">Inactive organizations cannot log in</p>
                    </div>
                    <button
                        onClick={() => setIsActive(!isActive)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isActive ? 'bg-blue-600' : 'bg-slate-300 dark:bg-gray-600'
                            }`}
                    >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${isActive ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                </div>
            </div>

            {changed && (
                <div className="mt-4 flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => { setPlan(org.plan); setIsActive(org.is_active) }}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                </div>
            )}
        </div>
    )
}
