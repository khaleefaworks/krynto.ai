import { useCallback } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { JSONContent } from '@tiptap/core'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Bold, Italic, ListOrdered, Smile } from 'lucide-react'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'

// ── Markdown serializer (same logic as ChatComposer) ──────────────────────────

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\`*_\[\]]/g, (m) => `\\${m}`)
}

function wrapInline(text: string, bold: boolean, italic: boolean): string {
  // Move surrounding whitespace OUTSIDE the delimiters so we never produce
  // `***Hello! ***` (space adjacent to closing delimiter is invalid GFM).
  const leadMatch = /^\s+/.exec(text)
  const trailMatch = /\s+$/.exec(text)
  const leading = leadMatch ? leadMatch[0] : ''
  const trailing = trailMatch ? trailMatch[0] : ''
  let inner = text.slice(leading.length, trailing.length ? text.length - trailing.length : undefined)
  if (!inner) return text
  if (italic) inner = `*${inner}*`
  if (bold) inner = `**${inner}**`
  return leading + inner + trailing
}

function serializeInline(node: any): string {
  if (!node) return ''
  if (node.type === 'text') {
    const base = escapeMarkdownText(String(node.text || ''))
    const marks = Array.isArray(node.marks) ? node.marks : []
    const bold = marks.some((m: any) => m?.type === 'bold')
    const italic = marks.some((m: any) => m?.type === 'italic')
    return wrapInline(base, bold, italic)
  }
  if (node.type === 'hardBreak') return '\n'
  if (Array.isArray(node.content)) return node.content.map(serializeInline).join('')
  return ''
}

function serializeBlock(node: any): string {
  if (!node) return ''
  if (node.type === 'paragraph') {
    return (node.content || []).map(serializeInline).join('')
  }
  if (node.type === 'bulletList') {
    return (node.content || [])
      .map((li: any) => {
        const para = (li?.content || []).find((n: any) => n?.type === 'paragraph')
        return `- ${para ? (para.content || []).map(serializeInline).join('') : ''}`
      })
      .join('\n')
  }
  if (node.type === 'orderedList') {
    let idx = 1
    return (node.content || [])
      .map((li: any) => {
        const para = (li?.content || []).find((n: any) => n?.type === 'paragraph')
        return `${idx++}. ${para ? (para.content || []).map(serializeInline).join('') : ''}`
      })
      .join('\n')
  }
  if (Array.isArray(node.content)) {
    return node.content.map((c: any) => serializeBlock(c)).filter(Boolean).join('\n\n')
  }
  return ''
}

function serializeToMarkdown(doc: JSONContent | null | undefined): string {
  const blocks = Array.isArray((doc as any)?.content) ? (doc as any).content : []
  const parts: string[] = []
  for (const b of blocks) {
    const t = serializeBlock(b).trimEnd()
    if (t) parts.push(t)
  }
  return parts.join('\n\n').trim()
}

// ── Plain-text / Markdown → Tiptap doc ───────────────────────────────────────

function parseInlineMarkdown(text: string): any[] {
  const nodes: any[] = []
  let i = 0
  while (i < text.length) {
    // Backslash escape: \* → literal *
    if (text[i] === '\\' && i + 1 < text.length) {
      nodes.push({ type: 'text', text: text[i + 1] })
      i += 2
      continue
    }
    if (text[i] === '*') {
      // Bold + Italic: ***text*** — must check before **
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
      // Unmatched * — emit as literal
      nodes.push({ type: 'text', text: '*' })
      i += 1
      continue
    }
    // Plain text up to next * or \
    const nextStar = text.indexOf('*', i)
    const nextSlash = text.indexOf('\\', i)
    const next = Math.min(
      nextStar === -1 ? text.length : nextStar,
      nextSlash === -1 ? text.length : nextSlash,
    )
    const plain = text.slice(i, next)
    if (plain) nodes.push({ type: 'text', text: plain })
    i = next
  }
  return nodes
}

function markdownToDoc(md: string): JSONContent {
  if (!md) return { type: 'doc', content: [{ type: 'paragraph' }] }
  const blocks: any[] = []
  const paragraphs = md.split(/\n\n+/)
  for (const para of paragraphs) {
    const lines = para.split('\n')
    // Ordered list
    if (lines.length > 0 && /^\d+\.\s+/.test(lines[0])) {
      const items = lines
        .filter((l) => /^\d+\.\s+/.test(l))
        .map((l) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarkdown(l.replace(/^\d+\.\s+/, '')) }],
        }))
      if (items.length) blocks.push({ type: 'orderedList', content: items })
      continue
    }
    // Regular paragraph (hard breaks for single newlines)
    const content: any[] = []
    for (let idx = 0; idx < lines.length; idx++) {
      if (idx > 0) content.push({ type: 'hardBreak' })
      content.push(...parseInlineMarkdown(lines[idx]))
    }
    if (content.length) blocks.push({ type: 'paragraph', content })
  }
  return blocks.length ? { type: 'doc', content: blocks } : { type: 'doc', content: [{ type: 'paragraph' }] }
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  defaultValue?: string
  onChange: (markdown: string) => void
  placeholder?: string
  disabled?: boolean
  minRows?: number
}

export default function RichTextEditor({
  defaultValue = '',
  onChange,
  placeholder = 'Type your message…',
  disabled = false,
  minRows = 4,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        blockquote: false,
        heading: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: defaultValue ? markdownToDoc(defaultValue) : undefined,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none outline-none whitespace-pre-wrap break-words',
      },
      handleKeyDown: (_view, event) => {
        const e = event as KeyboardEvent
        if (!editor) return false
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
        return false
      },
    },
    onUpdate: ({ editor }) => {
      onChange(serializeToMarkdown(editor.getJSON()))
    },
  })

  const insertEmoji = useCallback(
    (emoji: string) => {
      editor?.chain().focus().insertContent(emoji).run()
    },
    [editor],
  )

  const minHeightStyle = { minHeight: `${minRows * 1.5}rem` }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-shadow">
      {/* Editor area */}
      <div className="px-3 py-2.5 overflow-y-auto" style={minHeightStyle}>
        <EditorContent editor={editor} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-gray-100 dark:border-gray-700">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 dark:text-gray-400 ${editor?.isActive('bold') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : ''}`}
          title="Bold (Ctrl+B)"
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 dark:text-gray-400 ${editor?.isActive('italic') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : ''}`}
          title="Italic (Ctrl+I)"
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 dark:text-gray-400 ${editor?.isActive('orderedList') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : ''}`}
          title="Numbered list"
          disabled={!editor || disabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 dark:text-gray-400"
              title="Emoji"
              disabled={!editor || disabled}
            >
              <Smile className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[352px] p-0" align="start" side="top" sideOffset={8}>
            <EmojiPicker
              theme={isDark() ? Theme.DARK : Theme.LIGHT}
              searchDisabled={false}
              skinTonesDisabled={false}
              onEmojiClick={(emoji: EmojiClickData) => insertEmoji(emoji.emoji)}
            />
          </PopoverContent>
        </Popover>

        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 pr-1 select-none">
          Ctrl+B · Ctrl+I
        </span>
      </div>
    </div>
  )
}
