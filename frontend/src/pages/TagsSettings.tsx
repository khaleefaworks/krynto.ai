import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Trash2, Tag as TagIcon } from 'lucide-react'

interface Tag {
    id: number
    name: string
    color: string
    description: string | null
    created_at: string
    updated_at: string | null
}

export default function TagsSettings() {
    const [tags, setTags] = useState<Tag[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const [editing, setEditing] = useState<Partial<Tag> | null>(null)

    const sortedTags = useMemo(() => {
        return [...tags].sort((a, b) => a.name.localeCompare(b.name))
    }, [tags])

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiRequest<Tag[]>('/tags')
            setTags(Array.isArray(data) ? data : [])
        } catch (e: any) {
            setError(e?.message || 'Failed to load tags')
            setTags([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    const resetMessagesSoon = () => {
        setTimeout(() => {
            setSuccess(null)
            setError(null)
        }, 2500)
    }

    const saveTag = async () => {
        if (!editing) return
        const name = String(editing.name || '').trim()
        const color = String(editing.color || '').trim() || '#000000'
        const description = (editing.description ?? '')

        if (!name) {
            setError('Tag name is required')
            resetMessagesSoon()
            return
        }

        setSaving(true)
        setError(null)
        setSuccess(null)
        try {
            if (editing.id) {
                await apiRequest(`/tags/${editing.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name, color, description }),
                })
                setSuccess('Tag updated')
            } else {
                await apiRequest('/tags', {
                    method: 'POST',
                    body: JSON.stringify({ name, color, description }),
                })
                setSuccess('Tag created')
            }

            setEditing(null)
            await load()
            resetMessagesSoon()
        } catch (e: any) {
            setError(e?.message || 'Failed to save tag')
            resetMessagesSoon()
        } finally {
            setSaving(false)
        }
    }

    const deleteTag = async (id: number) => {
        if (!confirm('Deleting this tag will remove it from all conversations where it is used. This cannot be undone. Continue?')) return
        setSaving(true)
        setError(null)
        setSuccess(null)
        try {
            await apiRequest(`/tags/${id}`, { method: 'DELETE' })
            setSuccess('Tag deleted')
            await load()
            resetMessagesSoon()
        } catch (e: any) {
            setError(e?.message || 'Failed to delete tag')
            resetMessagesSoon()
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="p-8">
            <div className="max-w-5xl">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <TagIcon className="w-6 h-6" />
                        Conversation Tags
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Global tags available across all websites.
                    </p>
                </div>

                {(error || success) && (
                    <div className={`mb-4 rounded-md p-3 text-sm ${error ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-200' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-200'}`}>
                        {error || success}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Tags</CardTitle>
                            <CardDescription>{loading ? 'Loading…' : `${sortedTags.length} total`}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
                            ) : sortedTags.length === 0 ? (
                                <div className="text-sm text-gray-500 dark:text-gray-400">No tags yet.</div>
                            ) : (
                                <div className="space-y-2">
                                    {sortedTags.map((t) => (
                                        <div key={t.id} className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
                                            <button
                                                type="button"
                                                className="flex items-center gap-3 min-w-0 text-left"
                                                onClick={() => setEditing({ ...t })}
                                                disabled={saving}
                                                title="Edit"
                                            >
                                                <span className="inline-flex h-5 w-5 rounded" style={{ backgroundColor: t.color }} />
                                                <span className="font-medium text-gray-900 dark:text-white truncate">{t.name}</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                    {t.description || ''}
                                                </span>
                                            </button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => deleteTag(t.id)}
                                                disabled={saving}
                                                className="text-red-600 hover:text-red-700"
                                                title="Delete"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{editing?.id ? 'Edit Tag' : 'Create Tag'}</CardTitle>
                            <CardDescription>Managers/System Managers only.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                                <Input
                                    value={String(editing?.name || '')}
                                    onChange={(e) => setEditing({ ...(editing || {}), name: e.target.value })}
                                    placeholder="e.g. Urgent"
                                    disabled={saving}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={String(editing?.color || '#000000')}
                                        onChange={(e) => setEditing({ ...(editing || {}), color: e.target.value })}
                                        className="w-10 h-10 p-0 border-0 rounded"
                                        disabled={saving}
                                    />
                                    <Input
                                        value={String(editing?.color || '#000000')}
                                        onChange={(e) => setEditing({ ...(editing || {}), color: e.target.value })}
                                        placeholder="#000000"
                                        disabled={saving}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
                                <Input
                                    value={String(editing?.description || '')}
                                    onChange={(e) => setEditing({ ...(editing || {}), description: e.target.value })}
                                    placeholder="What is this tag used for?"
                                    disabled={saving}
                                />
                            </div>

                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setEditing(null)}
                                    disabled={saving}
                                >
                                    Clear
                                </Button>
                                <Button
                                    type="button"
                                    onClick={saveTag}
                                    disabled={saving}
                                >
                                    {saving ? 'Saving…' : (editing?.id ? 'Save' : 'Create')}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
