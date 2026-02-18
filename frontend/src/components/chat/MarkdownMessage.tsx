import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Schema } from 'hast-util-sanitize'

import { cn } from '@/lib/utils'

type Props = {
    content: string | null | undefined
    className?: string
}

function linkifyPlainDomains(raw: string): string {
    const input = String(raw || '')
    if (!input) return ''

    // Protect inline code spans.
    const parts = input.split(/(`[^`]*`)/g)

    const mdHolders: string[] = []
    const stashMd = (s: string) => {
        const token = `@@MDHOLDER_${mdHolders.length}@@`
        mdHolders.push(s)
        return token
    }
    const unstashMd = (s: string) =>
        s.replace(/@@MDHOLDER_(\d+)@@/g, (_m, idx) => mdHolders[Number(idx)] ?? _m)

    const linkifySegment = (segment: string) => {
        // Stash existing markdown links/images so we don't rewrite inside them.
        let s = segment
        s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, stashMd)
        s = s.replace(/\[[^\]]*\]\([^)]*\)/g, stashMd)

        // Linkify bare domains like abc.com or sub.abc.co.in (but not emails).
        // Skip already-protocol URLs; those are handled by markdown/gfm.
        s = s.replace(
            /(^|[^\w@])(\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]{2,})\b)(?!\s*\)|\/)/gi,
            (_m, pre, domain) => `${pre}[${domain}](https://${domain})`
        )

        return unstashMd(s)
    }

    for (let i = 0; i < parts.length; i += 1) {
        // Odd indices are code spans (`...`) - keep untouched.
        if (i % 2 === 1) continue
        parts[i] = linkifySegment(parts[i])
    }

    return parts.join('')
}

type AttributeList = NonNullable<Schema['attributes']>[string]

function asAttributeList(value: unknown): AttributeList {
    return Array.isArray(value) ? (value as AttributeList) : []
}

const sanitizeSchema: typeof defaultSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        a: [
            ...asAttributeList(defaultSchema.attributes?.a),
            'href',
            'title',
            'target',
            'rel',
        ],
        img: [
            ...asAttributeList(defaultSchema.attributes?.img),
            'src',
            'alt',
            'title',
            'loading',
            'decoding',
        ],
    },
    protocols: {
        ...defaultSchema.protocols,
        href: ['http', 'https', 'mailto', 'tel'],
        src: ['http', 'https'],
    },
}

export default function MarkdownMessage({ content, className }: Props) {
    const text = linkifyPlainDomains(String(content || ''))

    return (
        <div className={cn('break-words', className)}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                components={{
                    a: ({ href, children, ...props }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                            {...props}
                        >
                            {children}
                        </a>
                    ),
                    img: ({ src, alt, ...props }) => {
                        const safeSrc = typeof src === 'string' ? src : undefined
                        if (!safeSrc) return null

                        return (
                            <a
                                href={safeSrc}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block"
                                title={alt || 'Open image'}
                            >
                                <img
                                    src={safeSrc}
                                    alt={alt || ''}
                                    loading="lazy"
                                    decoding="async"
                                    className="max-w-[220px] max-h-[160px] object-cover rounded cursor-zoom-in"
                                    {...props}
                                />
                            </a>
                        )
                    },
                    ol: ({ children, ...props }) => (
                        <ol className="list-decimal pl-5 space-y-1" {...props}>
                            {children}
                        </ol>
                    ),
                    ul: ({ children, ...props }) => (
                        <ul className="list-disc pl-5 space-y-1" {...props}>
                            {children}
                        </ul>
                    ),
                    p: ({ children, ...props }) => (
                        <p className="whitespace-pre-wrap" {...props}>
                            {children}
                        </p>
                    ),
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    )
}
