import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { apiRequest } from "@/services/api"
import { Plus, Trash2, Zap } from "lucide-react"

interface Shortcut {
    id: number
    user_id: number
    shortcut: string
    message: string
    is_active: boolean
    created_at: string
    updated_at: string | null
}

export default function PersonalShortcutsSettings() {
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [newShortcut, setNewShortcut] = useState("")
    const [newMessage, setNewMessage] = useState("")
    const [newActive, setNewActive] = useState(true)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiRequest<Shortcut[]>("/shortcuts")
            setShortcuts(data)
        } catch (e: any) {
            setError(e?.message || "Failed to load shortcuts")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    const sorted = useMemo(() => {
        return [...shortcuts].sort((a, b) => a.shortcut.localeCompare(b.shortcut))
    }, [shortcuts])

    const handleCreate = async () => {
        const shortcut = newShortcut.trim()
        const message = newMessage.trim()
        if (!shortcut || !message) {
            setError("Shortcut and message are required")
            return
        }

        setSaving(true)
        setError(null)
        try {
            const created = await apiRequest<Shortcut>("/shortcuts", {
                method: "POST",
                body: JSON.stringify({ shortcut, message, is_active: newActive }),
            })
            setShortcuts((prev) => [...prev, created])
            setNewShortcut("")
            setNewMessage("")
            setNewActive(true)
        } catch (e: any) {
            setError(e?.message || "Failed to create shortcut")
        } finally {
            setSaving(false)
        }
    }

    const handleToggleActive = async (item: Shortcut, isActive: boolean) => {
        setShortcuts((prev) => prev.map((s) => (s.id === item.id ? { ...s, is_active: isActive } : s)))
        try {
            const updated = await apiRequest<Shortcut>(`/shortcuts/${item.id}`, {
                method: "PUT",
                body: JSON.stringify({ is_active: isActive }),
            })
            setShortcuts((prev) => prev.map((s) => (s.id === item.id ? updated : s)))
        } catch (e: any) {
            // revert on failure
            setShortcuts((prev) => prev.map((s) => (s.id === item.id ? { ...s, is_active: item.is_active } : s)))
            setError(e?.message || "Failed to update shortcut")
        }
    }

    const handleDelete = async (item: Shortcut) => {
        if (!confirm(`Delete shortcut '${item.shortcut}'?`)) return

        setError(null)
        const prev = shortcuts
        setShortcuts((s) => s.filter((x) => x.id !== item.id))
        try {
            await apiRequest<void>(`/shortcuts/${item.id}`, { method: "DELETE" })
        } catch (e: any) {
            setShortcuts(prev)
            setError(e?.message || "Failed to delete shortcut")
        }
    }

    return (
        <div>
            <div className="h-16 flex items-center border-b dark:border-gray-700 px-6">
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Personal Shortcuts</h1>
            </div>

            <div className="max-w-2xl px-6 py-6 space-y-6">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Create quick-reply shortcuts. Type <kbd className="mx-0.5 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono font-semibold text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">/</kbd> or <kbd className="mx-0.5 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono font-semibold text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">.</kbd> at the start of a message to trigger them.
                </p>

                {error && (
                    <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800">
                        {error}
                    </div>
                )}

                {/* Create form */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Plus className="h-4 w-4" /> New Shortcut
                    </h3>

                    <div className="flex items-center gap-3">
                        <div className="flex-1">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Trigger word</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 font-mono text-sm">/</span>
                                <Input
                                    value={newShortcut}
                                    onChange={(e) => setNewShortcut(e.target.value)}
                                    placeholder="hello"
                                    className="pl-7 dark:bg-gray-800 dark:border-gray-700"
                                />
                            </div>
                        </div>
                        <div className="flex items-end pb-0.5">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <Switch checked={newActive} onCheckedChange={setNewActive} />
                                <span className="text-xs text-gray-600 dark:text-gray-400">Active</span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Reply message</label>
                        <Textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Hello! How can I help you today?"
                            rows={3}
                            className="dark:bg-gray-800 dark:border-gray-700 resize-none"
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button size="sm" onClick={handleCreate} disabled={saving || !newShortcut.trim() || !newMessage.trim()}>
                            {saving ? "Creating…" : "Create Shortcut"}
                        </Button>
                    </div>
                </div>

                {/* Existing shortcuts */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                        Your Shortcuts {!loading && <span className="font-normal text-gray-500 dark:text-gray-400">({sorted.length})</span>}
                    </h3>

                    {loading ? (
                        <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading…</div>
                    ) : sorted.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 py-10 text-center">
                            <Zap className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                            <p className="text-sm text-gray-500 dark:text-gray-400">No shortcuts yet</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create one above to get started.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {sorted.map((s) => (
                                <div
                                    key={s.id}
                                    className="group flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <code className="text-sm font-semibold text-gray-900 dark:text-gray-100">/{s.shortcut}</code>
                                            {!s.is_active && (
                                                <span className="text-[10px] uppercase tracking-wider font-medium text-gray-400 dark:text-gray-500">Disabled</span>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words line-clamp-2">
                                            {s.message}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                                        <Switch checked={s.is_active} onCheckedChange={(v) => handleToggleActive(s, v)} />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(s)}
                                            className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
