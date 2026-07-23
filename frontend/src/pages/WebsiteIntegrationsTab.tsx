import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiRequest } from '@/services/api'
import { Loader2, Plus, Trash2, Pencil } from 'lucide-react'

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
        metadata_fields?: string[]
        custom_fields?: Record<string, string>
    }
}

interface FormOption {
    id: number
    name: string
}

interface MetadataFieldOption {
    id: string
    label: string
    description: string
}

interface CustomFieldRow {
    key: string
    value: string
}

export default function WebsiteIntegrationsTab({ websiteId }: { websiteId: number }) {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [webhooks, setWebhooks] = useState<Webhook[]>([])
    const [forms, setForms] = useState<FormOption[]>([])
    const [metadataFieldCatalog, setMetadataFieldCatalog] = useState<MetadataFieldOption[]>([])

    // mode is null (panel closed), 'create', or 'edit'; editingHookId only
    // matters for 'edit'. Both modes share the same form state/panel below.
    const [mode, setMode] = useState<'create' | 'edit' | null>(null)
    const [editingHookId, setEditingHookId] = useState<number | null>(null)
    const [formName, setFormName] = useState('')
    const [formUrl, setFormUrl] = useState('')
    const [formSecret, setFormSecret] = useState('')
    const [formFormId, setFormFormId] = useState<string>('')
    const [formMetadataFields, setFormMetadataFields] = useState<string[]>([])
    const [formCustomFields, setFormCustomFields] = useState<CustomFieldRow[]>([])
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [hooksData, formsData, catalogData] = await Promise.all([
                apiRequest<Webhook[]>(`/websites/${websiteId}/integrations`),
                apiRequest<FormOption[]>(`/websites/${websiteId}/forms`),
                apiRequest<MetadataFieldOption[]>(`/websites/${websiteId}/integrations/metadata-fields`),
            ])
            setWebhooks(Array.isArray(hooksData) ? hooksData : [])
            setForms(Array.isArray(formsData) ? formsData : [])
            setMetadataFieldCatalog(Array.isArray(catalogData) ? catalogData : [])
        } catch (e: any) {
            setError(e?.message || 'Failed to load integrations')
        } finally {
            setLoading(false)
        }
    }, [websiteId])

    useEffect(() => { load() }, [load])

    const closePanel = () => {
        setMode(null)
        setEditingHookId(null)
    }

    const startCreate = () => {
        setFormName('')
        setFormUrl('')
        setFormSecret('')
        setFormFormId('')
        setFormMetadataFields([])
        setFormCustomFields([])
        setEditingHookId(null)
        setError(null)
        setMode('create')
    }

    const startEdit = (hook: Webhook) => {
        setFormName(hook.name)
        setFormUrl(hook.config?.url || '')
        setFormSecret('')
        setFormFormId(hook.form_id != null ? String(hook.form_id) : '')
        setFormMetadataFields(hook.config?.metadata_fields || [])
        setFormCustomFields(
            Object.entries(hook.config?.custom_fields || {}).map(([key, value]) => ({ key, value: String(value) }))
        )
        setEditingHookId(hook.id)
        setError(null)
        setMode('edit')
    }

    const toggleMetadataField = (id: string) => {
        setFormMetadataFields(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id])
    }

    const addCustomFieldRow = () => setFormCustomFields(prev => [...prev, { key: '', value: '' }])
    const updateCustomFieldRow = (idx: number, patch: Partial<CustomFieldRow>) =>
        setFormCustomFields(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
    const removeCustomFieldRow = (idx: number) => setFormCustomFields(prev => prev.filter((_, i) => i !== idx))

    const handleSave = async () => {
        setError(null)
        if (!formUrl.trim()) { setError('Webhook URL is required.'); return }
        setSaving(true)
        const customFieldsDict = Object.fromEntries(
            formCustomFields.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
        )
        const body = {
            name: formName.trim() || 'Webhook',
            url: formUrl.trim(),
            secret: formSecret.trim() || undefined,
            form_id: formFormId ? Number(formFormId) : null,
            metadata_fields: formMetadataFields,
            custom_fields: customFieldsDict,
        }
        try {
            if (mode === 'edit' && editingHookId != null) {
                await apiRequest(`/websites/${websiteId}/integrations/webhooks/${editingHookId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(body),
                })
            } else {
                await apiRequest(`/websites/${websiteId}/integrations/webhooks`, {
                    method: 'POST',
                    body: JSON.stringify(body),
                })
            }
            closePanel()
            await load()
        } catch (e: any) {
            setError(e?.message || 'Failed to save webhook.')
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
                {mode === null && (
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

            {mode !== null && (
                <div className="max-w-md flex flex-col gap-3 mb-6 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Name</label>
                        <Input
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            placeholder="e.g. Frappe CRM"
                            className="dark:bg-gray-800 dark:border-gray-700"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Webhook URL</label>
                        <Input
                            value={formUrl}
                            onChange={e => setFormUrl(e.target.value)}
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
                            value={formSecret}
                            onChange={e => setFormSecret(e.target.value)}
                            placeholder={mode === 'edit' ? 'Leave blank to keep the current secret' : 'Used to HMAC-sign the payload'}
                            className="dark:bg-gray-800 dark:border-gray-700"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                            Scope to form <span className="text-xs text-gray-400">(optional)</span>
                        </label>
                        <select
                            value={formFormId}
                            onChange={e => setFormFormId(e.target.value)}
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

                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                            Include with every lead <span className="text-xs text-gray-400">(optional)</span>
                        </label>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-2.5">
                            {metadataFieldCatalog.map(f => (
                                <label key={f.id} className="flex items-start gap-2 text-xs cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5"
                                        checked={formMetadataFields.includes(f.id)}
                                        onChange={() => toggleMetadataField(f.id)}
                                    />
                                    <span>
                                        <span className="block text-gray-700 dark:text-gray-300">{f.label}</span>
                                        <span className="block text-gray-400 dark:text-gray-500">{f.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Custom fields <span className="text-xs text-gray-400 font-normal">(optional)</span>
                            </label>
                            <button
                                type="button"
                                onClick={addCustomFieldRow}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
                            >
                                <Plus className="h-3.5 w-3.5" /> Add field
                            </button>
                        </div>
                        {formCustomFields.length > 0 && (
                            <div className="space-y-2">
                                {formCustomFields.map((row, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <Input
                                            value={row.key}
                                            onChange={e => updateCustomFieldRow(idx, { key: e.target.value })}
                                            placeholder="Key, e.g. crm_pipeline"
                                            className="h-8 text-sm dark:bg-gray-800 dark:border-gray-700"
                                        />
                                        <Input
                                            value={row.value}
                                            onChange={e => updateCustomFieldRow(idx, { value: e.target.value })}
                                            placeholder="Value"
                                            className="h-8 text-sm dark:bg-gray-800 dark:border-gray-700"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeCustomFieldRow(idx)}
                                            className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            Static key/value pairs sent as-is with every lead from this webhook.
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                            Save
                        </Button>
                        <Button variant="outline" onClick={closePanel} disabled={saving}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : webhooks.length === 0 && mode === null ? (
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
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                                onClick={() => startEdit(hook)}
                                title="Edit webhook"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
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
                <code>website_id</code>, <code>conversation_id</code> and <code>captured_at</code>. If you selected
                any fields under "Include with every lead", they're sent as a <code>metadata</code> object; any
                custom fields are sent as a <code>custom_fields</code> object. If a secret is set, it's included as
                a plain <code>secret</code> field in that same JSON body — check it with a simple string comparison
                on your end. (No HMAC signature header — most no-code/sandboxed webhook receivers, like a Frappe
                Server Script, can't compute one, and over HTTPS a body-level secret is just as safe.)
            </p>
        </div>
    )
}
