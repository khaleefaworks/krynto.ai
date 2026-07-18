import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiRequest } from '@/services/api'
import { Loader2, Plus, Trash2 } from 'lucide-react'

// Generic outbound webhooks for captured leads (offline gate + live-chat
// contact card) — a website can register any number of them (Frappe's own
// webhook doctype, Zapier, n8n, a custom endpoint, whatever). See
// docs/tasks.md INT1. WebsiteIntegration.type is generic server-side so a
// second integration kind later is a new card here, not a rewrite.

interface Webhook {
    id: number
    website_id: number
    type: string
    name: string
    enabled: boolean
    form_id: number | null
    form_name: string | null
    config: {
        url?: string
        secret_set?: boolean
    }
}

interface FormOption {
    id: number
    name: string
}

export default function WebsiteIntegrationsTab({ websiteId }: { websiteId: number }) {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [webhooks, setWebhooks] = useState<Webhook[]>([])
    const [forms, setForms] = useState<FormOption[]>([])

    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newUrl, setNewUrl] = useState('')
    const [newSecret, setNewSecret] = useState('')
    const [newFormId, setNewFormId] = useState<string>('')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [hooksData, formsData] = await Promise.all([
                apiRequest<Webhook[]>(`/websites/${websiteId}/integrations`),
                apiRequest<FormOption[]>(`/websites/${websiteId}/forms`),
            ])
            setWebhooks(Array.isArray(hooksData) ? hooksData : [])
            setForms(Array.isArray(formsData) ? formsData : [])
        } catch (e: any) {
            setError(e?.message || 'Failed to load integrations')
        } finally {
            setLoading(false)
        }
    }, [websiteId])

    useEffect(() => { load() }, [load])

    const startCreate = () => {
        setNewName('')
        setNewUrl('')
        setNewSecret('')
        setNewFormId('')
        setError(null)
        setCreating(true)
    }

    const handleCreate = async () => {
        setError(null)
        if (!newUrl.trim()) { setError('Webhook URL is required.'); return }
        setSaving(true)
        try {
            await apiRequest(`/websites/${websiteId}/integrations/webhooks`, {
                method: 'POST',
                body: JSON.stringify({
                    name: newName.trim() || 'Webhook',
                    url: newUrl.trim(),
                    secret: newSecret.trim() || undefined,
                    form_id: newFormId ? Number(newFormId) : null,
                }),
            })
            setCreating(false)
            await load()
        } catch (e: any) {
            setError(e?.message || 'Failed to create webhook.')
        } finally {
            setSaving(false)
        }
    }

    const handleScopeChange = async (hook: Webhook, formId: string) => {
        const nextFormId = formId ? Number(formId) : null
        setWebhooks(prev => prev.map(h => h.id === hook.id ? { ...h, form_id: nextFormId } : h))
        try {
            await apiRequest(`/websites/${websiteId}/integrations/webhooks/${hook.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ form_id: nextFormId }),
            })
            await load()
        } catch (e: any) {
            setError(e?.message || 'Failed to update webhook scope.')
            await load()
        }
    }

    const handleToggleEnabled = async (hook: Webhook, enabled: boolean) => {
        setWebhooks(prev => prev.map(h => h.id === hook.id ? { ...h, enabled } : h))
        try {
            await apiRequest(`/websites/${websiteId}/integrations/webhooks/${hook.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled }),
            })
        } catch (e: any) {
            setError(e?.message || 'Failed to update webhook.')
            await load()
        }
    }

    const handleDelete = async (hook: Webhook) => {
        if (!window.confirm(`Remove the webhook "${hook.name}"?`)) return
        try {
            await apiRequest(`/websites/${websiteId}/integrations/webhooks/${hook.id}`, { method: 'DELETE' })
            setWebhooks(prev => prev.filter(h => h.id !== hook.id))
        } catch (e: any) {
            setError(e?.message || 'Failed to delete webhook.')
        }
    }

    return (
        <div className="flex flex-col h-full overflow-auto px-6 py-5">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Integrations</h2>
                {!creating && (
                    <Button size="sm" onClick={startCreate}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add webhook
                    </Button>
                )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                Push captured leads (offline gate + live-chat contact card) to any webhook URL —
                Frappe, Zapier, n8n, or your own endpoint.
            </p>

            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

            {creating && (
                <div className="max-w-md flex flex-col gap-3 mb-6 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Name</label>
                        <Input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="e.g. Frappe CRM"
                            className="dark:bg-gray-800 dark:border-gray-700"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Webhook URL</label>
                        <Input
                            value={newUrl}
                            onChange={e => setNewUrl(e.target.value)}
                            placeholder="https://your-endpoint.example.com/webhook"
                            className="dark:bg-gray-800 dark:border-gray-700"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                            Signing secret <span className="text-xs text-gray-400">(optional)</span>
                        </label>
                        <Input
                            type="password"
                            value={newSecret}
                            onChange={e => setNewSecret(e.target.value)}
                            placeholder="Used to HMAC-sign the payload"
                            className="dark:bg-gray-800 dark:border-gray-700"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                            Scope to form <span className="text-xs text-gray-400">(optional)</span>
                        </label>
                        <select
                            value={newFormId}
                            onChange={e => setNewFormId(e.target.value)}
                            className="w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm px-2 text-gray-900 dark:text-white"
                        >
                            <option value="">All forms (website-wide)</option>
                            {forms.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            Leave as "All forms" to fire for every lead on this website. Pick a form to only
                            fire when that specific form captures a lead — useful when different forms should
                            route to different systems.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={handleCreate} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                            Save
                        </Button>
                        <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : webhooks.length === 0 && !creating ? (
                <p className="text-sm text-gray-400 dark:text-gray-600 italic">No webhooks registered yet.</p>
            ) : (
                <div className="max-w-2xl space-y-2">
                    {webhooks.map(hook => (
                        <div
                            key={hook.id}
                            className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{hook.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{hook.config?.url}</div>
                                {hook.config?.secret_set && (
                                    <div className="text-xs text-gray-400 dark:text-gray-500">Signed with a secret</div>
                                )}
                            </div>
                            <select
                                value={hook.form_id ?? ''}
                                onChange={(e) => handleScopeChange(hook, e.target.value)}
                                className="h-8 rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-xs px-2 text-gray-700 dark:text-gray-300 max-w-[140px]"
                                title="Which form's leads this webhook fires for"
                            >
                                <option value="">All forms</option>
                                {forms.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                            <Switch checked={hook.enabled} onCheckedChange={(v) => handleToggleEnabled(hook, v)} />
                            <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:text-red-700 dark:text-red-400"
                                onClick={() => handleDelete(hook)}
                                title="Delete webhook"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-5 max-w-2xl">
                Each captured lead is POSTed as JSON: <code>name</code>, <code>email</code>, <code>phone</code>,{' '}
                <code>extra_fields</code> (anything else the contact-card form collected), <code>source</code>,{' '}
                <code>website_id</code>, <code>conversation_id</code> and <code>captured_at</code>. If a secret is
                set, it's included as a plain <code>secret</code> field in that same JSON body — check it with a
                simple string comparison on your end. (No HMAC signature header — most no-code/sandboxed webhook
                receivers, like a Frappe Server Script, can't compute one, and over HTTPS a body-level secret is
                just as safe.)
            </p>
        </div>
    )
}
