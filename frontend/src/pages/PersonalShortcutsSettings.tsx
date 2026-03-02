import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { apiRequest } from "@/services/api"

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

            <div className="max-w-4xl px-6 py-4">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
                    Create your own quick replies. Trigger them by typing <span className="font-mono">/</span> or <span className="font-mono">.</span> at the start of a message.
                </p>

                {error && (
                    <div className="mb-4 p-3 rounded-md text-sm bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300">
                        {error}
                    </div>
                )}

                <Card className="mb-4">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Create shortcut</CardTitle>
                        <CardDescription className="text-xs">Example: <span className="font-mono">hello</span> expands to your message.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Shortcut</label>
                                <Input
                                    value={newShortcut}
                                    onChange={(e) => setNewShortcut(e.target.value)}
                                    placeholder="hello"
                                    className="dark:bg-gray-800 dark:border-gray-700"
                                />
                            </div>
                            <div className="flex items-end gap-3">
                                <div className="flex items-center gap-2">
                                    <Switch checked={newActive} onCheckedChange={setNewActive} />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Message</label>
                            <Textarea
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="Hello! How can I help you today?"
                                className="dark:bg-gray-800 dark:border-gray-700"
                            />
                        </div>

                        <div className="flex justify-end">
                            <Button size="sm" onClick={handleCreate} disabled={saving}>
                                {saving ? "Saving..." : "Create"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Your shortcuts</CardTitle>
                        <CardDescription className="text-xs">{loading ? "Loading..." : `${sorted.length} total`}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {sorted.length === 0 ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">No shortcuts yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {sorted.map((s) => (
                                    <div
                                        key={s.id}
                                        className="flex items-start justify-between gap-4 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-3">
                                                <div className="font-mono text-sm text-gray-900 dark:text-gray-100">/{s.shortcut}</div>
                                                <div className="flex items-center gap-2">
                                                    <Switch checked={s.is_active} onCheckedChange={(v) => handleToggleActive(s, v)} />
                                                    <span className="text-xs text-gray-600 dark:text-gray-400">Active</span>
                                                </div>
                                            </div>
                                            <div className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                                                {s.message}
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0">
                                            <Button variant="ghost" size="sm" onClick={() => handleDelete(s)}>
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
