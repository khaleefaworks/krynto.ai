import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiRequest } from '@/services/api'
import { Loader2, Plus, Trash2, X, Search, Webhook as WebhookIcon } from 'lucide-react'

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

type PanelMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; item: Webhook }

// Stand-in shown in the secret field for a webhook that already has one set —
// never the real value, which the server never sends back (see _integration_to_dict).
const SECRET_MASK = '••••••••••••••••'

export default function WebsiteIntegrationsTab({ websiteId }: { websiteId: number }) {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [webhooks, setWebhooks] = useState<Webhook[]>([])
    const [forms, setForms] = useState<FormOption[]>([])
    const [metadataFieldCatalog, setMetadataFieldCatalog] = useState<MetadataFieldOption[]>([])
    const [search, setSearch] = useState('')

    // Panel state
    const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' })
    const [formName, setFormName] = useState('')
    const [formUrl, setFormUrl] = useState('')
    const [formSecret, setFormSecret] = useState('')
    const [secretTouched, setSecretTouched] = useState(false)
    const [formFormId, setFormFormId] = useState<string>('')
    const [formMetadataFields, setFormMetadataFields] = useState<string[]>([])
    const [formCustomFields, setFormCustomFields] = useState<CustomFieldRow[]>([])
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // ─── Data ─────────────────────────────────────────────
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

    const filtered = useMemo(() => {
        const list = [...webhooks].sort((a, b) => a.name.localeCompare(b.name))
        if (!search.trim()) return list
        const q = search.trim().toLowerCase()
        return list.filter(h =>
            h.name.toLowerCase().includes(q) || (h.config?.url || '').toLowerCase().includes(q)
        )
    }, [webhooks, search])

    // ─── Panel helpers ────────────────────────────────────
    const openCreate = () => {
        setFormName('')
        setFormUrl('')
        setFormSecret('')
        setSecretTouched(false)
        setFormFormId('')
        setFormMetadataFields([])
        setFormCustomFields([])
        setError(null)
        setPanel({ kind: 'create' })
    }

    const openEdit = (hook: Webhook) => {
        setFormName(hook.name)
        setFormUrl(hook.config?.url || '')
        setFormSecret('')
        setSecretTouched(false)
        setFormFormId(hook.form_id != null ? String(hook.form_id) : '')
        setFormMetadataFields(hook.config?.metadata_fields || [])
        setFormCustomFields(
            Object.entries(hook.config?.custom_fields || {}).map(([key, value]) => ({ key, value: String(value) }))
        )
        setError(null)
        setPanel({ kind: 'edit', item: hook })
    }

    const closePanel = () => setPanel({ kind: 'closed' })

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && panel.kind !== 'closed') closePanel()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [panel.kind])

    const toggleMetadataField = (id: string) => {
        setFormMetadataFields(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id])
    }

    const addCustomFieldRow = () => setFormCustomFields(prev => [...prev, { key: '', value: '' }])
    const updateCustomFieldRow = (idx: number, patch: Partial<CustomFieldRow>) =>
        setFormCustomFields(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
    const removeCustomFieldRow = (idx: number) => setFormCustomFields(prev => prev.filter((_, i) => i !== idx))

    // ─── CRUD ─────────────────────────────────────────────
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
            if (panel.kind === 'edit') {
                await apiRequest(`/websites/${websiteId}/integrations/webhooks/${panel.item.id}`, {
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

    const handleDelete = async () => {
        if (panel.kind !== 'edit') return
        const item = panel.item
        if (!window.confirm(`Remove the webhook "${item.name}"?`)) return
        setDeleting(true)
        setError(null)
        try {
            await apiRequest(`/websites/${websiteId}/integrations/webhooks/${item.id}`, { method: 'DELETE' })
            setWebhooks(prev => prev.filter(h => h.id !== item.id))
            closePanel()
        } catch (e: any) {
            setError(e?.message || 'Failed to delete webhook.')
        } finally {
            setDeleting(false)
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

    const panelOpen = panel.kind !== 'closed'
    const secretAlreadySet = panel.kind === 'edit' && !!panel.item.config?.secret_set
    // Show the mask as the field's actual value (not just a placeholder) until the
    // user focuses in to replace it — then it behaves like a normal empty input.
    const secretFieldValue = secretAlreadySet && !secretTouched ? SECRET_MASK : formSecret

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-1 flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Integrations</h2>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Webhook
                </Button>
            </div>

            {/* Subtitle + Search */}
            <div className="px-6 pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 flex-shrink-0">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Push captured leads (offline gate + live-chat contact card) to any webhook URL —
                    Frappe, Zapier, n8n, or your own endpoint.
                </p>
                {webhooks.length > 0 && (
                    <div className="relative flex-shrink-0 w-full sm:w-52">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search…"
                            className="pl-8 h-8 text-sm dark:bg-gray-800 dark:border-gray-700"
                        />
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto px-6 pb-6">
                {error && !panelOpen && (
                    <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
                ) : filtered.length === 0 && !search.trim() ? (
                    <div className="py-16 text-center">
                        <WebhookIcon className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No webhooks registered yet</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Add one to start pushing captured leads out.</p>
                        <Button size="sm" variant="outline" onClick={openCreate}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Webhook
                        </Button>
                    </div>
                ) : filtered.length === 0 && search.trim() ? (
                    <div className="py-16 text-center text-sm text-gray-400">No webhooks matching &ldquo;{search}&rdquo;</div>
                ) : (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
                        <table className="w-full text-sm min-w-[520px]">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Webhook</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-36">Scope</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-20">Enabled</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filtered.map(hook => (
                                    <tr
                                        key={hook.id}
                                        onClick={() => openEdit(hook)}
                                        className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <td className="px-4 py-3 min-w-0">
                                            <div className="font-medium text-gray-900 dark:text-white truncate">{hook.name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{hook.config?.url}</div>
                                            {hook.config?.secret_set && (
                                                <div className="text-xs text-gray-400 dark:text-gray-500">Signed with a secret</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 truncate">
                                            {hook.form_name || 'All forms'}
                                        </td>
                                        <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                            <Switch checked={hook.enabled} onCheckedChange={v => handleToggleEnabled(hook, v)} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {webhooks.length > 0 && (
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
                )}
            </div>

            {/* ─── Slide-over panel ─── */}
            {panelOpen && (
                <>
                    <div className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10" onClick={closePanel} />
                    <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200">
                        {/* Panel header */}
                        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                {panel.kind === 'create' ? 'Add Webhook' : 'Edit Webhook'}
                            </h3>
                            <button
                                type="button"
                                onClick={closePanel}
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

                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Name</label>
                                <Input
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    placeholder="e.g. Frappe CRM"
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                    autoFocus
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
                                    Signing secret <span className="text-xs text-gray-400 font-normal">(optional)</span>
                                </label>
                                <Input
                                    type="password"
                                    value={secretFieldValue}
                                    onFocus={() => setSecretTouched(true)}
                                    onBlur={() => { if (!formSecret.trim()) setSecretTouched(false) }}
                                    onChange={e => { setSecretTouched(true); setFormSecret(e.target.value) }}
                                    placeholder={
                                        panel.kind === 'edit'
                                            ? (secretAlreadySet ? undefined : 'No secret set')
                                            : 'Used to HMAC-sign the payload'
                                    }
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                />
                                {panel.kind === 'edit' && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                        {secretAlreadySet
                                            ? "A secret is set (it can't be shown again for security) — click the field to replace it."
                                            : 'No secret set. Type one to start signing this webhook, or leave blank to send it unsigned.'}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                                    Scope to form <span className="text-xs text-gray-400 font-normal">(optional)</span>
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
                                    Include with every lead <span className="text-xs text-gray-400 font-normal">(optional)</span>
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
                        </div>

                        {/* Panel footer */}
                        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 flex-shrink-0">
                            <div className="flex items-center justify-between">
                                {panel.kind === 'edit' ? (
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        {deleting ? 'Deleting…' : 'Delete'}
                                    </button>
                                ) : (
                                    <span />
                                )}
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={closePanel}>Cancel</Button>
                                    <Button
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={saving || !formUrl.trim()}
                                    >
                                        {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                                        {saving ? 'Saving…' : panel.kind === 'create' ? 'Create' : 'Save Changes'}
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
