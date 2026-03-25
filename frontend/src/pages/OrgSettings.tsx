import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isOrgOwner } from '@/lib/roles'
import { Building2, Check } from 'lucide-react'
import type { Organization } from '@/types/index'

export default function OrgSettings() {
    const { user, organization, setOrganization } = useAppStore()
    const [name, setName] = useState(organization?.name || '')
    const [loading, setLoading] = useState(!organization)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        if (organization) {
            setName(organization.name)
            setLoading(false)
            return
        }
        apiRequest<Organization>('/organization')
            .then((data) => {
                setOrganization(data)
                setName(data.name)
            })
            .catch((e) => setError(e?.message || 'Failed to load'))
            .finally(() => setLoading(false))
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
            setTimeout(() => setSaved(false), 2000)
        } catch (e: any) {
            setError(e?.message || 'Save failed')
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="p-6 text-slate-400">Loading…</div>

    const canEdit = isOrgOwner(user)

    return (
        <div className="p-6 max-w-xl">
            <div className="flex items-center gap-2 mb-6">
                <Building2 size={20} className="text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Organization Settings</h2>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y dark:divide-gray-700">
                <div className="px-5 py-4">
                    <label className="text-xs text-slate-400 block mb-1.5">Organization Name</label>
                    {canEdit ? (
                        <div className="flex gap-2">
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                maxLength={255}
                            />
                            <Button
                                onClick={handleSave}
                                disabled={saving || name.trim() === (organization?.name || '')}
                                size="sm"
                                className="shrink-0"
                            >
                                {saved ? <Check size={14} /> : saving ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-700 dark:text-slate-200">{organization?.name}</p>
                    )}
                    {!canEdit && (
                        <p className="text-xs text-slate-400 mt-1">Only the Organization Owner can change the name.</p>
                    )}
                </div>

                {organization?.slug && (
                    // slug is an internal backend identifier — intentionally hidden from UI
                    null
                )}

                <div className="px-5 py-4">
                    <label className="text-xs text-slate-400 block mb-1.5">Plan</label>
                    <p className="text-sm text-slate-700 dark:text-slate-200 capitalize">{organization?.plan || '—'}</p>
                </div>
            </div>
        </div>
    )
}
