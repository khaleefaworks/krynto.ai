import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { apiRequest } from '@/services/api'
import { Plus, X, Trash2, FileText, Search, ChevronUp, ChevronDown } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormField {
    name: string
    label: string
    field_type: 'text' | 'email' | 'phone' | 'textarea' | 'select'
    required: boolean
    options: string[]
    placeholder?: string
}

interface WebsiteForm {
    id: number
    website_id: number
    name: string
    slug: string
    fields: FormField[]
    submit_label: string
    enabled: boolean
    is_contact_card: boolean
    created_at: string
    updated_at: string | null
}

type PanelMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; item: WebsiteForm }

const EMPTY_FIELD: FormField = {
    name: '',
    label: '',
    field_type: 'text',
    required: false,
    options: [],
    placeholder: '',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "My Form Name" → "my-form-name" */
function toSlug(s: string) {
    const str = (s || '').toString()
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** "Your Email Address" → "your_email_address" */
function toFieldName(s: string) {
    const str = (s || '').toString()
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WebsiteFormsTab({ websiteId }: { websiteId: number }) {
    const [forms, setForms] = useState<WebsiteForm[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    // Panel state
    const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' })
    const [formName, setFormName] = useState('')
    const [formSlug, setFormSlug] = useState('')
    const [slugTouched, setSlugTouched] = useState(false)
    const [formSubmitLabel, setFormSubmitLabel] = useState('Send')
    const [formEnabled, setFormEnabled] = useState(true)
    const [formIsContactCard, setFormIsContactCard] = useState(false)
    const [formFields, setFormFields] = useState<FormField[]>([{ ...EMPTY_FIELD }])
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // ─── Data ─────────────────────────────────────────────
    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiRequest<WebsiteForm[]>(`/websites/${websiteId}/forms`)
            setForms(Array.isArray(data) ? data : [])
        } catch (e: any) {
            setError(e?.message || 'Failed to load forms')
        } finally {
            setLoading(false)
        }
    }, [websiteId])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => {
        const list = [...forms].sort((a, b) => a.name.localeCompare(b.name))
        if (!search.trim()) return list
        const q = search.trim().toLowerCase()
        return list.filter(f => f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q))
    }, [forms, search])

    // ─── Panel helpers ────────────────────────────────────
    const openCreate = () => {
        setFormName('')
        setFormSlug('')
        setSlugTouched(false)
        setFormSubmitLabel('Send')
        setFormEnabled(true)
        setFormIsContactCard(false)
        setFormFields([{ ...EMPTY_FIELD }])
        setError(null)
        setPanel({ kind: 'create' })
    }

    const openEdit = (item: WebsiteForm) => {
        setFormName(item.name)
        setFormSlug(item.slug)
        setSlugTouched(true)
        setFormSubmitLabel(item.submit_label)
        setFormEnabled(item.enabled)
        setFormIsContactCard(!!item.is_contact_card)
        setFormFields(
            item.fields && item.fields.length > 0
                ? item.fields.map((f: any) => ({
                    name: String(f?.name || f?.field_name || ''),
                    label: String(f?.label || ''),
                    field_type: (f?.field_type || f?.type || 'text') as FormField['field_type'],
                    required: !!f?.required,
                    options: Array.isArray(f?.options) ? f.options : [],
                    placeholder: f?.placeholder || '',
                }))
                : [{ ...EMPTY_FIELD }]
        )
        setError(null)
        setPanel({ kind: 'edit', item })
    }

    const closePanel = () => {
        setPanel({ kind: 'closed' })
        setError(null)
    }

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && panel.kind !== 'closed') closePanel()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [panel.kind])

    // ─── Name → slug auto-derive ──────────────────────────
    const handleNameChange = (val: string) => {
        setFormName(val)
        if (!slugTouched) setFormSlug(toSlug(val))
    }

    // ─── Field helpers ────────────────────────────────────
    const updateField = (idx: number, patch: Partial<FormField>) => {
        setFormFields(prev => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
    }

    const handleFieldLabelChange = (idx: number, label: string) => {
        setFormFields(prev => prev.map((f, i) => {
            if (i !== idx) return f
            const prevAutoName = toFieldName(f.label || '')
            const nameIsAuto = (f.name || '') === '' || (f.name || '') === prevAutoName
            return { ...f, label, name: nameIsAuto ? toFieldName(label) : (f.name || '') }
        }))
    }

    const addField = () => setFormFields(prev => [...prev, { ...EMPTY_FIELD }])
    const removeField = (idx: number) => setFormFields(prev => prev.filter((_, i) => i !== idx))

    const moveField = (idx: number, dir: -1 | 1) => {
        const next = [...formFields]
        const swap = idx + dir
        if (swap < 0 || swap >= next.length) return
        ;[next[idx], next[swap]] = [next[swap], next[idx]]
        setFormFields(next)
    }

    // ─── Save ─────────────────────────────────────────────
    const handleSave = async () => {
        if (!formName.trim()) { setError('Form name is required.'); return }
        if (!formSlug.trim()) { setError('Slug is required.'); return }
        if (!/^[a-z0-9_-]+$/.test(formSlug)) {
            setError('Slug may only contain lowercase letters, numbers, hyphens and underscores.')
            return
        }
        const validFields = formFields.filter(f => (f.label || '').toString().trim())
        if (validFields.length === 0) { setError('Add at least one field.'); return }
        for (const f of validFields) {
            const fname = (f.name || '').toString().trim()
            const flabel = (f.label || '').toString().trim()
            if (!fname) { setError(`Field "${flabel || '(unnamed)'}" is missing a field name.`); return }
            if (!/^[a-z0-9_]+$/.test(fname)) {
                setError(`Field name "${fname}" may only contain lowercase letters, numbers and underscores.`)
                return
            }
        }

        const body = {
            name: formName.trim(),
            slug: formSlug.trim(),
            submit_label: formSubmitLabel.trim() || 'Send',
            enabled: formEnabled,
            is_contact_card: formIsContactCard,
            fields: validFields.map(f => {
                const fname = (f.name || '').toString().trim()
                const flabel = (f.label || '').toString().trim()
                return {
                    name: fname,
                    label: flabel,
                    field_type: f.field_type || 'text',
                    required: !!f.required,
                    options: f.field_type === 'select' ? (Array.isArray(f.options) ? f.options : []).filter(o => (o || '').toString().trim()) : [],
                    placeholder: (f.placeholder || '').toString().trim() || undefined,
                }
            }),
        }

        setSaving(true)
        setError(null)
        try {
            if (panel.kind === 'edit') {
                await apiRequest(`/websites/${websiteId}/forms/${panel.item.id}`, { method: 'PUT', body: JSON.stringify(body) })
            } else {
                await apiRequest(`/websites/${websiteId}/forms`, { method: 'POST', body: JSON.stringify(body) })
            }
            await load()
            closePanel()
        } catch (e: any) {
            setError(e?.message || 'Failed to save form.')
        } finally {
            setSaving(false)
        }
    }

    // ─── Delete ───────────────────────────────────────────
    const handleDelete = async () => {
        if (panel.kind !== 'edit') return
        setDeleting(true)
        setError(null)
        try {
            await apiRequest(`/websites/${websiteId}/forms/${panel.item.id}`, { method: 'DELETE' })
            setForms(prev => prev.filter(f => f.id !== (panel as { kind: 'edit'; item: WebsiteForm }).item.id))
            closePanel()
        } catch (e: any) {
            setError(e?.message || 'Failed to delete form.')
        } finally {
            setDeleting(false)
        }
    }

    // ─── Toggle enabled inline ────────────────────────────
    const handleToggle = async (item: WebsiteForm, enabled: boolean) => {
        setForms(prev => prev.map(f => f.id === item.id ? { ...f, enabled } : f))
        try {
            await apiRequest(`/websites/${websiteId}/forms/${item.id}`, {
                method: 'PUT',
                body: JSON.stringify({ enabled }),
            })
        } catch {
            setForms(prev => prev.map(f => f.id === item.id ? { ...f, enabled: item.enabled } : f))
        }
    }

    const panelOpen = panel.kind !== 'closed'

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-1 flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Forms</h2>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    New Form
                </Button>
            </div>

            {/* Subtitle + Search */}
            <div className="px-6 pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 flex-shrink-0">
                <p className="text-sm text-gray-500 dark:text-gray-400">Capture visitor data via automation actions.</p>
                {forms.length > 0 && (
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
                        <FileText className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No forms yet</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Create a form and trigger it from an automation action.</p>
                        <Button size="sm" variant="outline" onClick={openCreate}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Form
                        </Button>
                    </div>
                ) : filtered.length === 0 && search.trim() ? (
                    <div className="py-16 text-center text-sm text-gray-400">No forms matching &ldquo;{search}&rdquo;</div>
                ) : (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
                        <table className="w-full text-sm min-w-[480px]">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Name</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Slug</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-16">Fields</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-20">Enabled</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filtered.map(f => (
                                    <tr
                                        key={f.id}
                                        onClick={() => openEdit(f)}
                                        className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                            {f.name}
                                            {f.is_contact_card && (
                                                <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 rounded">
                                                    Offline extra fields
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <code className="text-xs text-gray-500 dark:text-gray-400">{f.slug}</code>
                                        </td>
                                        <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400">{f.fields.length}</td>
                                        <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                            <Switch checked={f.enabled} onCheckedChange={v => handleToggle(f, v)} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ─── Slide-over panel ─── */}
            {panelOpen && (
                <>
                    <div className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10" onClick={closePanel} />
                    <div className="absolute top-0 right-0 h-full w-full max-w-lg bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200">
                        {/* Panel header */}
                        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                {panel.kind === 'create' ? 'New Form' : 'Edit Form'}
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

                            {/* Name */}
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                                    Name <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    value={formName}
                                    onChange={e => handleNameChange(e.target.value)}
                                    placeholder="e.g. Offline Contact Form"
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                    autoFocus
                                />
                            </div>

                            {/* Slug */}
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                                    Slug <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    value={formSlug}
                                    onChange={e => {
                                        setSlugTouched(true)
                                        setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))
                                    }}
                                    placeholder="e.g. offline-contact"
                                    className="font-mono dark:bg-gray-800 dark:border-gray-700"
                                />
                                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                                    Auto-generated from name. Used to reference this form in automations.
                                </p>
                            </div>

                            {/* Submit label + Enabled */}
                            <div className="flex items-end gap-3">
                                <div className="flex-1">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Submit button label</label>
                                    <Input
                                        value={formSubmitLabel}
                                        onChange={e => setFormSubmitLabel(e.target.value)}
                                        placeholder="Send"
                                        className="dark:bg-gray-800 dark:border-gray-700"
                                    />
                                </div>
                                <div className="flex items-center gap-2 pb-2">
                                    <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Enabled</span>
                                </div>
                            </div>

                            {/* Contact card: this form doubles as the offline gate's extra
                                fields. Only one form per website can be it — turning this on
                                turns it off elsewhere. Any enabled form (this one included) can
                                still be sent during live chat via the composer's "#" menu. */}
                            <div className="flex items-center gap-2">
                                <Switch checked={formIsContactCard} onCheckedChange={setFormIsContactCard} />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                    Use as offline form's extra fields
                                </span>
                            </div>

                            {/* Fields */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Fields</label>
                                    <button
                                        type="button"
                                        onClick={addField}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
                                    >
                                        <Plus className="h-3.5 w-3.5" /> Add field
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {formFields.map((field, idx) => (
                                        <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2.5">
                                            {/* Field header */}
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Field {idx + 1}</span>
                                                <div className="flex items-center gap-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveField(idx, -1)}
                                                        disabled={idx === 0}
                                                        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-25 transition-colors"
                                                    >
                                                        <ChevronUp className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveField(idx, 1)}
                                                        disabled={idx === formFields.length - 1}
                                                        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-25 transition-colors"
                                                    >
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeField(idx)}
                                                        className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Label + Field name */}
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Label</label>
                                                    <Input
                                                        value={field.label}
                                                        onChange={e => handleFieldLabelChange(idx, e.target.value)}
                                                        placeholder="e.g. Your Email"
                                                        className="h-8 text-sm dark:bg-gray-800 dark:border-gray-700"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Field name</label>
                                                    <Input
                                                        value={field.name}
                                                        onChange={e => updateField(idx, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                                                        placeholder="e.g. your_email"
                                                        className="h-8 text-sm font-mono dark:bg-gray-800 dark:border-gray-700"
                                                    />
                                                </div>
                                            </div>

                                            {/* Type + Placeholder */}
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Type</label>
                                                    <select
                                                        value={field.field_type}
                                                        onChange={e => updateField(idx, { field_type: e.target.value as FormField['field_type'] })}
                                                        className="w-full h-8 text-sm px-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                                    >
                                                        <option value="text">Text</option>
                                                        <option value="email">Email</option>
                                                        <option value="phone">Phone</option>
                                                        <option value="textarea">Textarea</option>
                                                        <option value="select">Select</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Placeholder</label>
                                                    <Input
                                                        value={field.placeholder || ''}
                                                        onChange={e => updateField(idx, { placeholder: e.target.value })}
                                                        placeholder="Optional"
                                                        className="h-8 text-sm dark:bg-gray-800 dark:border-gray-700"
                                                    />
                                                </div>
                                            </div>

                                            {/* Select options */}
                                            {field.field_type === 'select' && (
                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Options (one per line)</label>
                                                    <Textarea
                                                        value={field.options.join('\n')}
                                                        onChange={e => updateField(idx, { options: e.target.value.split('\n') })}
                                                        placeholder={"Option A\nOption B"}
                                                        className="text-sm min-h-[60px] dark:bg-gray-800 dark:border-gray-700"
                                                    />
                                                </div>
                                            )}

                                            {/* Required */}
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={field.required}
                                                    onCheckedChange={v => updateField(idx, { required: v })}
                                                />
                                                <span className="text-xs text-gray-600 dark:text-gray-400">Required</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
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
                                    <Button size="sm" onClick={handleSave} disabled={saving}>
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
