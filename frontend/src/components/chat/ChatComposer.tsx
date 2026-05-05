import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import type { JSONContent } from '@tiptap/core'

import { API_BASE } from '@/config/endpoints'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Paperclip, Send, Bold, Italic, ListOrdered, Smile, Sparkles, Loader2, X } from 'lucide-react'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'

export type ComposerShortcut = {
    id: number
    shortcut: string
    message: string
    is_active: boolean
}

type ShortcutMatch = {
    scope: 'personal' | 'website'
    id: number
    shortcut: string
    message: string
}

type Props = {
    conversationId: number | null
    onSend: (content: string) => void
    onTyping?: (value: string) => void
    disabled?: boolean
    placeholder?: string
    statusText?: string
    readOnlyText?: string
    personalShortcuts: ComposerShortcut[]
    websiteShortcuts: ComposerShortcut[]
}

type ShortcutContext = {
    open: boolean
    query: string
    start: number
    end: number
}

type UploadedAttachment = {
    id: string
    name: string
    url: string
    kind: 'image' | 'file'
}

function isDarkMode(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function getShortcutContext(value: string, cursorPos: number): ShortcutContext {
    const pos = Math.max(0, Math.min(cursorPos, value.length))

    const before = value.slice(0, pos)
    const lastWs = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t'))
    const start = lastWs >= 0 ? lastWs + 1 : 0

    const token = value.slice(start, pos)
    if (!token.startsWith('/') && !token.startsWith('.')) return { open: false, query: '', start: pos, end: pos }
    if (token.length === 1) return { open: true, query: '', start, end: pos }

    const query = token.slice(1).toLowerCase()
    // If the token already includes whitespace somehow, do not open.
    if (/\s/.test(query)) return { open: false, query: '', start: pos, end: pos }

    return { open: true, query, start, end: pos }
}

function pickShortcutMatches(query: string, personal: ComposerShortcut[], website: ComposerShortcut[]): ShortcutMatch[] {
    const q = String(query || '').toLowerCase()
    const match = (s: ComposerShortcut) => {
        const name = String(s.shortcut || '').toLowerCase()
        return q ? name.startsWith(q) : true
    }

    const personalMatches: ShortcutMatch[] = personal
        .filter((s) => s.is_active)
        .filter(match)
        .map((s) => ({ scope: 'personal', id: s.id, shortcut: s.shortcut, message: s.message }))

    const websiteMatches: ShortcutMatch[] = website
        .filter((s) => s.is_active)
        .filter(match)
        .map((s) => ({ scope: 'website', id: s.id, shortcut: s.shortcut, message: s.message }))

    return [...personalMatches, ...websiteMatches].slice(0, 8)
}

function getFullAttachmentUrl(url: string): string {
    const raw = String(url || '')
    if (!raw) return ''
    return raw.startsWith('http') ? raw : `${API_BASE}${raw}`
}

function escapeMarkdownText(value: string): string {
    // Keep this conservative; we only need to avoid accidentally creating markdown syntax.
    return value.replace(/[\\`*_\[\]]/g, (m) => `\\${m}`)
}

// Parse inline markdown (bold/italic) into an array of Tiptap inline nodes.
function parseInlineMarkdownNodes(text: string): any[] {
    const nodes: any[] = []
    let i = 0
    while (i < text.length) {
        if (text[i] === '*') {
            // Bold + Italic: ***text*** — must check before ** to avoid partial consume
            if (text[i + 1] === '*' && text[i + 2] === '*') {
                const close = text.indexOf('***', i + 3)
                if (close !== -1) {
                    const inner = text.slice(i + 3, close)
                    if (inner) nodes.push({ type: 'text', text: inner, marks: [{ type: 'bold' }, { type: 'italic' }] })
                    i = close + 3
                    continue
                }
            }
            // Bold: **text**
            if (text[i + 1] === '*') {
                const close = text.indexOf('**', i + 2)
                if (close !== -1) {
                    const inner = text.slice(i + 2, close)
                    if (inner) nodes.push({ type: 'text', text: inner, marks: [{ type: 'bold' }] })
                    i = close + 2
                    continue
                }
            }
            // Italic: *text*
            const close = text.indexOf('*', i + 1)
            if (close !== -1) {
                const inner = text.slice(i + 1, close)
                if (inner) nodes.push({ type: 'text', text: inner, marks: [{ type: 'italic' }] })
                i = close + 1
                continue
            }
            // Unmatched * — emit as literal and advance to prevent infinite loop
            nodes.push({ type: 'text', text: '*' })
            i += 1
            continue
        }
        // Plain text up to the next * (or end)
        const next = text.indexOf('*', i)
        const plain = next === -1 ? text.slice(i) : text.slice(i, next)
        if (plain) nodes.push({ type: 'text', text: plain })
        i = next === -1 ? text.length : next
    }
    return nodes
}

// Convert a markdown string (from a shortcut) into Tiptap JSONContent so that
// bold/italic marks survive the round-trip through serializeDocToMarkdown.
function parseShortcutMarkdown(md: string): any {
    const blocks: any[] = []
    const paragraphs = String(md || '').split(/\n\n+/)
    for (const para of paragraphs) {
        const lines = para.split('\n')
        // Ordered list
        if (lines.length > 0 && /^\d+\.\s+/.test(lines[0])) {
            const items = lines
                .filter((l) => /^\d+\.\s+/.test(l))
                .map((l) => ({
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: parseInlineMarkdownNodes(l.replace(/^\d+\.\s+/, '')) }],
                }))
            if (items.length) blocks.push({ type: 'orderedList', content: items })
            continue
        }
        // Regular paragraph (with hard breaks for single newlines)
        const content: any[] = []
        for (let idx = 0; idx < lines.length; idx++) {
            if (idx > 0) content.push({ type: 'hardBreak' })
            content.push(...parseInlineMarkdownNodes(lines[idx]))
        }
        if (content.length) blocks.push({ type: 'paragraph', content })
    }
    return blocks.length
        ? { type: 'doc', content: blocks }
        : { type: 'doc', content: [{ type: 'paragraph' }] }
}

function escapeMarkdownLinkText(value: string): string {
    // Link labels also need to escape parentheses.
    return String(value || '').replace(/[\\`*_\[\]()/]/g, (m) => `\\${m}`)
}

function wrapInline(text: string, marks: { bold?: boolean; italic?: boolean; linkHref?: string | null }): string {
    // Move surrounding whitespace OUTSIDE the delimiters so we never produce
    // `***Hello! ***` (space adjacent to closing delimiter is invalid GFM).
    const leadMatch = /^\s+/.exec(text)
    const trailMatch = /\s+$/.exec(text)
    const leading = leadMatch ? leadMatch[0] : ''
    const trailing = trailMatch ? trailMatch[0] : ''
    let inner = text.slice(leading.length, trailing.length ? text.length - trailing.length : undefined)
    if (!inner) return text  // whitespace-only: skip wrapping
    if (marks.italic) inner = `*${inner}*`
    if (marks.bold) inner = `**${inner}**`
    if (marks.linkHref) inner = `[${inner}](${marks.linkHref})`
    return leading + inner + trailing
}

function serializeInline(node: any): string {
    if (!node) return ''
    if (node.type === 'text') {
        const base = escapeMarkdownText(String(node.text || ''))
        const marks = Array.isArray(node.marks) ? node.marks : []
        const bold = marks.some((m: any) => m?.type === 'bold')
        const italic = marks.some((m: any) => m?.type === 'italic')
        const link = marks.find((m: any) => m?.type === 'link')
        const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : null
        return wrapInline(base, { bold, italic, linkHref: href })
    }
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'image') {
        const src = typeof node?.attrs?.src === 'string' ? node.attrs.src : ''
        return src ? `![](${src})` : ''
    }
    if (Array.isArray(node.content)) return node.content.map(serializeInline).join('')
    return ''
}

function getClipboardFiles(e: ClipboardEvent): File[] {
    const out: File[] = []
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : []
    for (const item of items) {
        if (item.kind !== 'file') continue
        const f = item.getAsFile()
        if (f) out.push(f)
    }
    const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : []
    for (const f of files) out.push(f)
    return out
}

function serializeBlock(node: any, orderedIndex = 1): { text: string; nextIndex: number } {
    if (!node) return { text: '', nextIndex: orderedIndex }

    if (node.type === 'paragraph') {
        const line = (node.content || []).map(serializeInline).join('')
        return { text: line, nextIndex: orderedIndex }
    }

    if (node.type === 'bulletList') {
        const items = Array.isArray(node.content) ? node.content : []
        const lines = items
            .map((li: any) => {
                const firstPara = Array.isArray(li?.content) ? li.content.find((n: any) => n?.type === 'paragraph') : null
                const line = firstPara ? (firstPara.content || []).map(serializeInline).join('') : ''
                return line ? `- ${line}` : '-'
            })
            .join('\n')
        return { text: lines, nextIndex: orderedIndex }
    }

    if (node.type === 'orderedList') {
        const items = Array.isArray(node.content) ? node.content : []
        let idx = 1
        const lines = items
            .map((li: any) => {
                const firstPara = Array.isArray(li?.content) ? li.content.find((n: any) => n?.type === 'paragraph') : null
                const line = firstPara ? (firstPara.content || []).map(serializeInline).join('') : ''
                const out = line ? `${idx}. ${line}` : `${idx}.`
                idx += 1
                return out
            })
            .join('\n')
        return { text: lines, nextIndex: orderedIndex }
    }

    if (node.type === 'image') {
        const src = typeof node?.attrs?.src === 'string' ? node.attrs.src : ''
        return { text: src ? `![](${src})` : '', nextIndex: orderedIndex }
    }

    // Fallback: flatten
    if (Array.isArray(node.content)) {
        const parts: string[] = []
        let nextIndex = orderedIndex
        for (const child of node.content) {
            const r = serializeBlock(child, nextIndex)
            if (r.text) parts.push(r.text)
            nextIndex = r.nextIndex
        }
        return { text: parts.join('\n\n'), nextIndex }
    }

    return { text: '', nextIndex: orderedIndex }
}

function serializeDocToMarkdown(doc: JSONContent | null | undefined): string {
    const root = doc && typeof doc === 'object' ? (doc as any) : null
    const blocks = Array.isArray(root?.content) ? root.content : []
    const out: string[] = []
    for (const b of blocks) {
        const r = serializeBlock(b)
        const t = String(r.text || '').trimEnd()
        if (t) out.push(t)
    }
    return out.join('\n\n').trim()
}

export default function ChatComposer({
    conversationId,
    onSend,
    onTyping,
    disabled,
    placeholder,
    statusText,
    readOnlyText,
    personalShortcuts,
    websiteShortcuts,
}: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [uploadingCount, setUploadingCount] = useState(0)
    const [shortcutMenuIndex, setShortcutMenuIndex] = useState(0)
    const [selectionVersion, setSelectionVersion] = useState(0)

    const [plainValue, setPlainValue] = useState('')
    const [attachments, setAttachments] = useState<UploadedAttachment[]>([])

    const uploadingAttachment = uploadingCount > 0

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                // Keep marks/nodes minimal (Smartsupp-like).
                code: false,
                codeBlock: false,
                blockquote: false,
                heading: false,
                horizontalRule: false,
            }),
            Link.configure({
                openOnClick: false,
                autolink: true,
                linkOnPaste: true,
                protocols: ['http', 'https', 'mailto', 'tel'],
            }),
            Image.configure({
                inline: false,
                HTMLAttributes: {
                    class: 'chatassist-composer-img',
                },
            }),
            Placeholder.configure({
                placeholder: placeholder || 'Reply to live chat',
            }),
        ],
        editable: !disabled,
        // NOTE: editable is only used at init; a useEffect below keeps it in sync.
        editorProps: {
            attributes: {
                class:
                    'prose prose-sm dark:prose-invert max-w-none outline-none whitespace-pre-wrap break-words',
            },
            handlePaste: (_view, event) => {
                const e = event as ClipboardEvent
                if (!conversationId) return false

                const files = getClipboardFiles(e)
                const images = files.filter((f) => f.type && f.type.startsWith('image/'))
                if (images.length === 0) return false

                // We'll upload and insert image(s); prevent default paste.
                e.preventDefault()
                for (const img of images) {
                    void uploadAndInsertFile(img, { asPaste: true, preferImageNode: true })
                }
                return true
            },
            handleKeyDown: (_view, event) => {
                const e = event as KeyboardEvent
                if (!editor) return false

                const isInList = editor.isActive('orderedList') || editor.isActive('bulletList') || editor.isActive('listItem')

                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                    e.preventDefault()
                    editor.chain().focus().toggleBold().run()
                    return true
                }
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
                    e.preventDefault()
                    editor.chain().focus().toggleItalic().run()
                    return true
                }

                if (shortcutMenuOpen) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setShortcutMenuIndex((i) => Math.min(i + 1, shortcutMatches.length - 1))
                        return true
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setShortcutMenuIndex((i) => Math.max(i - 1, 0))
                        return true
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        const picked = shortcutMatches[shortcutMenuIndex] || shortcutMatches[0]
                        if (picked) {
                            applyPickedShortcut(picked.message)
                            setShortcutMenuIndex(0)
                        }
                        return true
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault()
                        setShortcutMenuIndex(0)
                        return true
                    }
                }

                if (e.key === 'Enter') {
                    // In lists, users rely on Shift+Enter (since Enter sends) to create the next list item.
                    if (isInList) {
                        e.preventDefault()
                        editor.chain().focus().splitListItem('listItem').run()
                        return true
                    }

                    if (e.shiftKey) {
                        e.preventDefault()
                        editor.chain().focus().setHardBreak().run()
                        return true
                    }

                    e.preventDefault()
                    sendNow()
                    return true
                }

                return false
            },
        },
        onUpdate: ({ editor }) => {
            const text = editor.getText()
            setPlainValue(text)
            onTyping?.(text)
            setShortcutMenuIndex(0)
        },
        onSelectionUpdate: () => {
            setSelectionVersion((v) => v + 1)
        },
    })

    const getMarkdown = useCallback(() => {
        if (!editor) return ''
        return serializeDocToMarkdown(editor.getJSON())
    }, [editor])

    const isEmpty = useMemo(() => {
        const t = String(plainValue || '').trim()
        return !t
    }, [plainValue])

    const shortcutCtx = useMemo(() => {
        if (!editor) return { open: false, query: '', start: 0, end: 0 }

        const from = editor.state.selection.from
        const $from = editor.state.selection.$from
        const blockStart = $from.start()
        const before = editor.state.doc.textBetween(blockStart, from, '\n', '\n')

        const lastWs = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t'))
        const startInBlock = lastWs >= 0 ? lastWs + 1 : 0
        const token = before.slice(startInBlock)

        if (!token.startsWith('/') && !token.startsWith('.')) return { open: false, query: '', start: from, end: from }
        if (token.length === 1) return { open: true, query: '', start: from - token.length, end: from }

        const query = token.slice(1).toLowerCase()
        if (/\s/.test(query)) return { open: false, query: '', start: from, end: from }
        return { open: true, query, start: from - token.length, end: from }
    }, [editor, plainValue, selectionVersion])
    const shortcutMatches = useMemo(
        () => (shortcutCtx.open ? pickShortcutMatches(shortcutCtx.query, personalShortcuts, websiteShortcuts) : []),
        [shortcutCtx.open, shortcutCtx.query, personalShortcuts, websiteShortcuts]
    )
    const shortcutMenuOpen = shortcutCtx.open && shortcutMatches.length > 0

    const focusEditor = useCallback(() => {
        requestAnimationFrame(() => editor?.commands.focus())
    }, [editor])

    const insertEmoji = useCallback(
        (emoji: string) => {
            if (!editor) return
            editor.chain().focus().insertContent(emoji).run()
        },
        [editor]
    )

    // Keep editor editable state in sync with the disabled prop
    // (useEditor only reads editable at initialization)
    useEffect(() => {
        if (editor) editor.setEditable(!disabled)
    }, [editor, disabled])

    const applyPickedShortcut = useCallback(
        (message: string) => {
            if (!editor) return
            const from = shortcutCtx.start
            const to = shortcutCtx.end
            editor.chain().focus().deleteRange({ from, to }).insertContent(parseShortcutMarkdown(message)).run()
        },
        [editor, shortcutCtx.end, shortcutCtx.start]
    )

    const removeAttachment = useCallback((id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id))
    }, [])

    const buildAttachmentsMarkdown = useCallback((): string => {
        const parts = attachments
            .map((a) => {
                if (!a?.url) return ''
                if (a.kind === 'image') return `![](${a.url})`
                const label = escapeMarkdownLinkText(a.name || 'Attachment')
                return `[${label}](${a.url})`
            })
            .filter(Boolean)
        return parts.join('\n')
    }, [attachments])

    const sendNow = useCallback(() => {
        if (!editor) return
        if (disabled) return

        const md = String(getMarkdown() || '').trim()
        const attachmentsMd = buildAttachmentsMarkdown().trim()
        const combined = [md, attachmentsMd].filter(Boolean).join('\n\n').trim()
        if (!combined || !conversationId) return

        onSend(combined)
        editor.commands.clearContent(true)
        setPlainValue('')
        setAttachments([])
        onTyping?.('')
        setShortcutMenuIndex(0)
    }, [buildAttachmentsMarkdown, conversationId, disabled, editor, getMarkdown, onSend, onTyping])

    const uploadAndInsertFile = useCallback(
        async (file: File, opts?: { asPaste?: boolean; preferImageNode?: boolean }) => {
            if (!conversationId) return
            if (!editor) return

            setUploadingCount((c) => c + 1)
            try {
                const form = new FormData()
                form.append('file', file)

                const token = localStorage.getItem('auth_token')
                const resp = await fetch(`${API_BASE}/attachments/upload?conversation_id=${conversationId}`, {
                    method: 'POST',
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    body: form,
                })

                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}))
                    throw new Error(err?.detail || 'Failed to upload attachment')
                }

                const data = await resp.json()
                const fullUrl = getFullAttachmentUrl(String(data?.url || ''))
                if (!fullUrl) return

                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
                const safeName = file.name ? String(file.name).trim() : 'Attachment'
                const kind: UploadedAttachment['kind'] = file.type && file.type.startsWith('image/') ? 'image' : 'file'
                setAttachments((prev) => [...prev, { id, name: safeName, url: fullUrl, kind }])

                // Best-effort: keep focus for smooth typing.
                if (opts?.asPaste) {
                    try {
                        editor.chain().focus().run()
                    } catch {
                        // ignore
                    }
                }
            } catch (e) {
                console.error('Attachment upload failed:', e)
            } finally {
                setUploadingCount((c) => Math.max(0, c - 1))
            }
        },
        [conversationId, editor]
    )
    const openShortcuts = useCallback(() => {
        if (!editor) return
        const ctx = shortcutCtx
        if (!ctx.open) {
            editor.chain().focus().insertContent('/').run()
            return
        }
        focusEditor()
    }, [editor, focusEditor, shortcutCtx])

    const currentTheme = isDarkMode() ? Theme.DARK : Theme.LIGHT

    return (
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-3 py-2 flex-shrink-0">
            {statusText ? (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 px-0.5 mb-1">{statusText}</div>
            ) : null}

            {attachments.length ? (
                <div className="flex flex-wrap gap-2 mb-2">
                    {attachments.map((a) => (
                        <div
                            key={a.id}
                            className="flex items-center gap-2 max-w-full px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                        >
                            <span className="text-xs text-gray-700 dark:text-gray-200 truncate max-w-[240px]">
                                {a.name}
                            </span>
                            <button
                                type="button"
                                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                                title="Remove"
                                onClick={() => removeAttachment(a.id)}
                                disabled={disabled}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}

            <div className="relative">
                {shortcutMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-full max-w-lg rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden z-50">
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Shortcuts</div>
                        <div className="max-h-64 overflow-auto">
                            {shortcutMatches.map((s, idx) => (
                                <button
                                    key={`${s.scope}-${s.id}`}
                                    type="button"
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${idx === shortcutMenuIndex ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                                    onMouseEnter={() => setShortcutMenuIndex(idx)}
                                    onClick={() => {
                                        applyPickedShortcut(s.message)
                                        setShortcutMenuIndex(0)
                                        focusEditor()
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="font-mono text-gray-900 dark:text-gray-100">/{s.shortcut}</div>
                                        <div className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                            {s.scope === 'website' ? 'Website' : 'Personal'}
                                        </div>
                                    </div>
                                    <div className="text-gray-600 dark:text-gray-400 truncate">{s.message}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                    <div className="px-3 py-4 max-h-36 overflow-y-auto min-h-[40px]">
                        <EditorContent editor={editor} />
                    </div>

                    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                onClick={openShortcuts}
                                title="Insert shortcut (/)"
                                disabled={!editor || disabled}
                            >
                                <Sparkles className="h-4 w-4" />
                            </Button>

                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                multiple
                                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                                onChange={async (e) => {
                                    const files = e.target.files ? Array.from(e.target.files) : []
                                    if (!files.length || !conversationId) return
                                    for (const file of files) {
                                        await uploadAndInsertFile(file, { preferImageNode: true })
                                    }
                                    if (fileInputRef.current) fileInputRef.current.value = ''
                                }}
                            />

                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                title="Attach file"
                                disabled={!conversationId || uploadingAttachment || disabled || !editor}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {uploadingAttachment ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Paperclip className="h-4 w-4" />
                                )}
                            </Button>

                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button type="button" variant="ghost" size="sm" className="dark:text-gray-400" title="Emoji" disabled={!editor || disabled}>
                                        <Smile className="h-4 w-4" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[352px] p-0" align="start" side="top" sideOffset={8}>
                                    <EmojiPicker
                                        theme={currentTheme}
                                        searchDisabled={false}
                                        skinTonesDisabled={false}
                                        onEmojiClick={(emoji: EmojiClickData) => {
                                            insertEmoji(emoji.emoji)
                                            focusEditor()
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>

                            <span className="mx-1 text-gray-300 dark:text-gray-600 select-none" aria-hidden="true">|</span>

                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                onClick={() => editor?.chain().focus().toggleBold().run()}
                                title="Bold (Ctrl+B)"
                                disabled={!editor || disabled}
                            >
                                <Bold className="h-4 w-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                onClick={() => editor?.chain().focus().toggleItalic().run()}
                                title="Italic (Ctrl+I)"
                                disabled={!editor || disabled}
                            >
                                <Italic className="h-4 w-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                                title="Numbered list"
                                disabled={!editor || disabled}
                            >
                                <ListOrdered className="h-4 w-4" />
                            </Button>
                        </div>

                        <Button
                            type="button"
                            onClick={sendNow}
                            disabled={(isEmpty && attachments.length === 0) || disabled || !conversationId || !editor || uploadingAttachment}
                            className="bg-blue-600 hover:bg-blue-700 rounded-full h-8 px-2 sm:px-3"
                            title="Send"
                        >
                            <div className="flex items-center gap-2">
                                <Send className="h-4 w-4" />
                                <span className="hidden sm:inline text-sm">Send</span>
                            </div>
                        </Button>
                    </div>
                </div>
            </div>

            <div className="mt-2 flex items-center justify-end gap-4 text-[11px] text-gray-500 dark:text-gray-400">
                <div>
                    Send <span className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">enter</span>
                </div>
                <div>
                    New line <span className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">shift</span> +{' '}
                    <span className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">enter</span>
                </div>
            </div>

            {disabled && readOnlyText ? (
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{readOnlyText}</p>
            ) : null}

        </div>
    )
}
