import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { apiRequest } from "@/services/api"
import { Plus, X, Trash2, Zap, Search } from "lucide-react"
import RichTextEditor from "@/components/RichTextEditor"

interface Shortcut {
    id: number
    user_id: number
    shortcut: string
    message: string
    is_active: boolean
    created_at: string
    updated_at: string | null
}

type PanelMode = { kind: "closed" } | { kind: "create" } | { kind: "edit"; item: Shortcut }

export default function PersonalShortcutsSettings() {
    const [shortcuts, setShortcuts] = useState<Shortcut[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState("")

    // Panel state
    const [panel, setPanel] = useState<PanelMode>({ kind: "closed" })
    const [formTrigger, setFormTrigger] = useState("")
    const [formMessage, setFormMessage] = useState("")
    const [formActive, setFormActive] = useState(true)
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)

    // ─── Data ─────────────────────────────────────────────
    const load = useCallback(async () => {
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
    }, [])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() => {
        const list = [...shortcuts].sort((a, b) => a.shortcut.localeCompare(b.shortcut))
        if (!search.trim()) return list
        const q = search.trim().toLowerCase()
        return list.filter(s =>
            s.shortcut.toLowerCase().includes(q) || s.message.toLowerCase().includes(q)
        )
    }, [shortcuts, search])

    // ─── Panel helpers ────────────────────────────────────
    const openCreate = () => {
        setFormTrigger("")
        setFormMessage("")
        setFormActive(true)
        setError(null)
        setPanel({ kind: "create" })
    }

    const openEdit = (item: Shortcut) => {
        setFormTrigger(item.shortcut)
        setFormMessage(item.message)
        setFormActive(item.is_active)
        setError(null)
        setPanel({ kind: "edit", item })
    }

    const closePanel = () => setPanel({ kind: "closed" })

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && panel.kind !== "closed") closePanel()
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [panel.kind])

    // ─── CRUD ─────────────────────────────────────────────
    const handleSave = async () => {
        const trigger = formTrigger.trim()
        const message = formMessage.trim()
        if (!trigger || !message) {
            setError("Trigger and message are required.")
            return
        }

        setSaving(true)
        setError(null)
        try {
            if (panel.kind === "create") {
                const created = await apiRequest<Shortcut>("/shortcuts", {
                    method: "POST",
                    body: JSON.stringify({ shortcut: trigger, message, is_active: formActive }),
                })
                setShortcuts(prev => [...prev, created])
            } else if (panel.kind === "edit") {
                const updated = await apiRequest<Shortcut>(`/shortcuts/${panel.item.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ shortcut: trigger, message, is_active: formActive }),
                })
                setShortcuts(prev => prev.map(s => s.id === updated.id ? updated : s))
            }
            closePanel()
        } catch (e: any) {
            setError(e?.message || "Failed to save shortcut.")
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (panel.kind !== "edit") return
        const item = panel.item
        setDeleting(true)
        setError(null)
        try {
            await apiRequest<void>(`/shortcuts/${item.id}`, { method: "DELETE" })
            setShortcuts(prev => prev.filter(s => s.id !== item.id))
            closePanel()
        } catch (e: any) {
            setError(e?.message || "Failed to delete shortcut.")
        } finally {
            setDeleting(false)
        }
    }

    const handleToggle = async (item: Shortcut, active: boolean) => {
        setShortcuts(prev => prev.map(s => s.id === item.id ? { ...s, is_active: active } : s))
        try {
            const updated = await apiRequest<Shortcut>(`/shortcuts/${item.id}`, {
                method: "PUT",
                body: JSON.stringify({ is_active: active }),
            })
            setShortcuts(prev => prev.map(s => s.id === updated.id ? updated : s))
        } catch (e: any) {
            setShortcuts(prev => prev.map(s => s.id === item.id ? { ...s, is_active: item.is_active } : s))
            setError(e?.message || "Failed to update shortcut.")
        }
    }

    const panelOpen = panel.kind !== "closed"

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            {/* Header */}
            <div className="h-16 flex items-center justify-between border-b dark:border-gray-700 px-6 flex-shrink-0">
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Shortcuts</h1>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    New Shortcut
                </Button>
            </div>

            {/* Subtitle + Search */}
            <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Type <kbd className="mx-0.5 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[11px] font-mono font-semibold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600">/</kbd> or <kbd className="mx-0.5 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[11px] font-mono font-semibold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600">.</kbd> in chat to trigger shortcuts.
                </p>
                {shortcuts.length > 0 && (
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
                {error && panel.kind === "closed" && (
                    <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
                ) : filtered.length === 0 && !search.trim() ? (
                    <div className="py-16 text-center">
                        <Zap className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No shortcuts yet</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Create one to speed up your replies.</p>
                        <Button size="sm" variant="outline" onClick={openCreate}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Shortcut
                        </Button>
                    </div>
                ) : filtered.length === 0 && search.trim() ? (
                    <div className="py-16 text-center text-sm text-gray-400">No shortcuts matching "{search}"</div>
                ) : (
                    /* Table */
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
                        <table className="w-full text-sm min-w-[420px]">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-40">Trigger</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Message</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-20">Active</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filtered.map(s => (
                                    <tr
                                        key={s.id}
                                        onClick={() => openEdit(s)}
                                        className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <code className="text-sm font-semibold text-gray-900 dark:text-gray-100">/{s.shortcut}</code>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 truncate max-w-0">
                                            <span className="block truncate">{s.message}</span>
                                        </td>
                                        <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                            <Switch checked={s.is_active} onCheckedChange={v => handleToggle(s, v)} />
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
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10"
                        onClick={closePanel}
                    />
                    {/* Panel */}
                    <div
                        ref={panelRef}
                        className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200"
                    >
                        {/* Panel header */}
                        <div className="h-16 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                                {panel.kind === "create" ? "New Shortcut" : "Edit Shortcut"}
                            </h2>
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
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Trigger word</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 font-mono text-sm">/</span>
                                    <Input
                                        value={formTrigger}
                                        onChange={e => setFormTrigger(e.target.value)}
                                        placeholder="hello"
                                        className="pl-7 dark:bg-gray-800 dark:border-gray-700"
                                        autoFocus
                                    />
                                </div>
                                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Single word, no spaces.</p>
                            </div>

                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Reply message</label>
                                <RichTextEditor
                                    key={panel.kind === "edit" ? `edit-${panel.item.id}` : "create"}
                                    defaultValue={formMessage}
                                    onChange={setFormMessage}
                                    placeholder="Hello! How can I help you today?"
                                    minRows={5}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</label>
                                <Switch checked={formActive} onCheckedChange={setFormActive} />
                            </div>
                        </div>

                        {/* Panel footer */}
                        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 flex-shrink-0">
                            <div className="flex items-center justify-between">
                                {panel.kind === "edit" ? (
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        {deleting ? "Deleting…" : "Delete"}
                                    </button>
                                ) : (
                                    <span />
                                )}
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={closePanel}>
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={saving || !formTrigger.trim() || !formMessage.trim()}
                                    >
                                        {saving ? "Saving…" : panel.kind === "create" ? "Create" : "Save Changes"}
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
