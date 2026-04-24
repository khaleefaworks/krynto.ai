import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { docsNav, findPage, getAdjacentPages } from '../config/docsNav'

/** Only slugs present in the docsNav allowlist are considered valid. */
function isValidSlug(slug: string): boolean {
  return docsNav.some((section) => section.pages.some((page) => page.slug === slug))
}

export default function DocsPage() {
  const { '*': slug } = useParams()
  const navigate = useNavigate()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const pageSlug = slug || 'getting-started/introduction'
  const pageInfo = findPage(pageSlug)
  const { prev, next } = getAdjacentPages(pageSlug)

  useEffect(() => {
    if (!pageSlug) return

    // Reject slugs that are not in the known allowlist to prevent path traversal
    if (!isValidSlug(pageSlug)) {
      setError(true)
      return
    }

    setContent(null)
    setError(false)

    const controller = new AbortController()

    fetch(`/docs-content/${pageSlug}.md`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        const ct = res.headers.get('content-type') || ''
        // Vite SPA fallback returns index.html (text/html) for unknown paths
        if (ct.includes('text/html')) throw new Error('not-found')
        return res.text()
      })
      .then((text) => {
        // Extra guard: if the file somehow returned HTML content
        if (text.trimStart().startsWith('<!')) throw new Error('not-found')
        setContent(text)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(true)
      })

    return () => controller.abort()
  }, [pageSlug])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-6">
        <p className="text-4xl mb-4">📄</p>
        <h1 className="text-xl font-semibold mb-2">Page not found</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          The page <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{pageSlug}</code> doesn't exist.
        </p>
        <button
          onClick={() => navigate('/docs/getting-started/introduction')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Go to Introduction
        </button>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="px-6 py-10 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/6" />
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-10 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      {pageInfo && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
          {pageInfo.section.title} / {pageInfo.page.title}
        </p>
      )}

      {/* Markdown content */}
      <div className="prose prose-gray dark:prose-invert max-w-none
        prose-headings:font-semibold
        prose-h1:text-2xl prose-h1:mb-6
        prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3
        prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2
        prose-p:text-sm prose-p:leading-relaxed prose-p:text-gray-700 dark:prose-p:text-gray-300
        prose-li:text-sm prose-li:text-gray-700 dark:prose-li:text-gray-300
        prose-code:text-xs prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-gray-100 dark:prose-pre:bg-gray-800 prose-pre:text-xs prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-gray-700
        prose-pre:text-gray-800 dark:prose-pre:text-gray-200
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit
        prose-table:text-sm prose-table:w-full
        prose-thead:border-b prose-thead:border-gray-200 dark:prose-thead:border-gray-700
        prose-th:text-left prose-th:font-semibold prose-th:text-xs prose-th:uppercase prose-th:tracking-wide prose-th:py-3 prose-th:px-4
        prose-th:bg-gray-50 dark:prose-th:bg-gray-800/60
        prose-td:text-sm prose-td:text-gray-700 dark:prose-td:text-gray-300 prose-td:py-3 prose-td:px-4
        prose-tr:border-b prose-tr:border-gray-100 dark:prose-tr:border-gray-800
        prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
        prose-blockquote:border-blue-400 prose-blockquote:bg-blue-50 dark:prose-blockquote:bg-blue-950/30 prose-blockquote:py-0.5 prose-blockquote:rounded-r-md prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400 prose-blockquote:not-italic
        prose-strong:text-gray-900 dark:prose-strong:text-gray-100
        prose-hr:border-gray-200 dark:prose-hr:border-gray-800
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>

      {/* Prev / Next navigation */}
      {(prev || next) && (
        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4">
          {prev ? (
            <Link
              to={`/docs/${prev.slug}`}
              className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors group"
            >
              <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              <span>{prev.title}</span>
            </Link>
          ) : <div />}
          {next ? (
            <Link
              to={`/docs/${next.slug}`}
              className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors group ml-auto"
            >
              <span>{next.title}</span>
              <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          ) : <div />}
        </div>
      )}
    </div>
  )
}
