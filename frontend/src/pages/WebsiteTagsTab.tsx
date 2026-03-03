import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiRequest } from '@/services/api'
import { Plus, X, Trash2, Tag, Search } from 'lucide-react'

interface WebsiteTag {
    id: number
    name: string
    color: string
    description: string | null
    website_id: number
    created_at: string
    updated_at: string | null
}

type PanelMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; item: WebsiteTag }

export default function WebsiteTagsTab({ websiteId }: { websiteId: number }) {
    const [tags, setTags] = useState<WebsiteTag[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    // Panel state
    const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' })
    const [formName, setFormName] = useState('')
    const [formColor, setFormColor] = useState('#3b82f6')
    const [formDescription, setFormDescription] = useState('')
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // ─── Data ─────────────────────────────────────────────
    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiRequest<WebsiteTag[]>(`/websites/${websiteId}/tags`)
            setTags(Array.isArray(data) ? data : [])
        } catch (e: any) {
            setError(e?.message || 'Failed to load tags')
        } finally {
            setLoading(false)
        }
    }, [websiteId])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => {
        const list = [...tags].sort((a, b) => a.name.localeCompare(b.name))
        if (!search.trim()) return list
        const q = search.trim().toLowerCase()
        return list.filter(t =>
            t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
        )
    }, [tags, search])

    // ─── Panel helpers ────────────────────────────────────
    const openCreate = () => {
        setFormName('')
        setFormColor('#3b82f6')
        setFormDescription('')
        setError(null)
        setPanel({ kind: 'create' })
    }

    const openEdit = (item: WebsiteTag) => {
        setFormName(item.name)
        setFormColor(item.color || '#000000')
        setFormDescription(item.description || '')
        setError(null)
        setPanel({ kind: 'edit', item })
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

    // ─── CRUD ─────────────────────────────────────────────
    const handleSave = async () => {
        const name = formName.trim()
        const color = formColor.trim() || '#000000'
        const description = formDescription.trim()
        if (!name) {
            setError('Tag name is required.')
            return
        }

        setSaving(true)
        setError(null)
        try {
            if (panel.kind === 'edit') {
                await apiRequest(`/websites/${websiteId}/tags/${panel.item.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name, color, description }),
                })
            } else {
                await apiRequest(`/websites/${websiteId}/tags`, {
                    method: 'POST',
                    body: JSON.stringify({ name, color, description }),
                })
            }
            closePanel()
            await load()
        } catch (e: any) {
            setError(e?.message || 'Failed to save tag.')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (panel.kind !== 'edit') return
        const item = panel.item
        setDeleting(true)
        setError(null)
        try {
            await apiRequest(`/websites/${websiteId}/tags/${item.id}`, { method: 'DELETE' })
            setTags(prev => prev.filter(t => t.id !== item.id))
            closePanel()
        } catch (e: any) {
            setError(e?.message || 'Failed to delete tag.')
        } finally {
            setDeleting(false)
        }
    }

    const panelOpen = panel.kind !== 'closed'

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-1 flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Tags</h2>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    New Tag
                </Button>
            </div>

            {/* Subtitle + Search */}
            <div className="px-6 pb-4 flex items-center justify-between gap-4 flex-shrink-0">
                <p className="text-sm text-gray-500 dark:text-gray-400">Manage conversation tags scoped to this website.</p>
                {tags.length > 0 && (
                    <div className="relative flex-shrink-0 w-52">
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
                        <Tag className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No tags yet</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Create tags to categorize conversations.</p>
                        <Button size="sm" variant="outline" onClick={openCreate}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Tag
                        </Button>
                    </div>
                ) : filtered.length === 0 && search.trim() ? (
                    <div className="py-16 text-center text-sm text-gray-400">No tags matching &ldquo;{search}&rdquo;</div>
                ) : (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Tag</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Description</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-20">Color</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filtered.map(t => (
                                    <tr
                                        key={t.id}
                                        onClick={() => openEdit(t)}
                                        className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <span className="inline-flex h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                                <span className="font-medium text-gray-900 dark:text-white">{t.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-0">
                                            <span className="block truncate">{t.description || '—'}</span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <code className="text-xs text-gray-500 dark:text-gray-400">{t.color}</code>
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
                    <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200">
                        {/* Panel header */}
                        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                {panel.kind === 'create' ? 'New Tag' : 'Edit Tag'}
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
                                    placeholder="e.g. Urgent"
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Color</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={formColor}
                                        onChange={e => setFormColor(e.target.value)}
                                        className="w-9 h-9 p-0 border-0 rounded cursor-pointer"
                                    />
                                    <Input
                                        value={formColor}
                                        onChange={e => setFormColor(e.target.value)}
                                        placeholder="#3b82f6"
                                        className="flex-1 dark:bg-gray-800 dark:border-gray-700"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Description</label>
                                <Input
                                    value={formDescription}
                                    onChange={e => setFormDescription(e.target.value)}
                                    placeholder="What is this tag used for?"
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                />
                            </div>

                            {/* Preview */}
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Preview</label>
                                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                                    <span className="inline-flex h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: formColor || '#000' }} />
                                    <span className="text-sm font-medium text-gray-900 dark:text-white">{formName || 'Tag name'}</span>
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
                                    <Button
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={saving || !formName.trim()}
                                    >
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
