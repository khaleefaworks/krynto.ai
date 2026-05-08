import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, X, Globe, ExternalLink, Search } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'
import DocsLink from '@/components/DocsLink'

interface Website {
  id: number
  name: string
  domain: string
  widget_config: {
    primary_color?: string
    position?: string
    header_icon_url?: string | null
  } | null
  created_at: string
}

type PanelMode = { kind: 'closed' } | { kind: 'create' }

export default function WebsitesList() {
  const navigate = useNavigate()
  const [websites, setWebsites] = useState<Website[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Panel state
  const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' })
  const [formName, setFormName] = useState('')
  const [formDomain, setFormDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // ─── Data ─────────────────────────────────────────────
  useEffect(() => {
    loadWebsites()
  }, [])

  const loadWebsites = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<Website[]>('/websites')
      setWebsites(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load websites')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const list = [...websites].sort((a, b) => a.name.localeCompare(b.name))
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(w =>
      w.name.toLowerCase().includes(q) || w.domain.toLowerCase().includes(q)
    )
  }, [websites, search])

  // ─── Panel helpers ────────────────────────────────────
  const openCreate = () => {
    setFormName('')
    setFormDomain('')
    setError(null)
    setPanel({ kind: 'create' })
  }

  const closePanel = () => setPanel({ kind: 'closed' })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panel.kind !== 'closed') closePanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [panel.kind])

  // ─── Create ───────────────────────────────────────────
  const handleCreate = async () => {
    const name = formName.trim()
    const domain = formDomain.trim()
    if (!name || !domain) {
      setError('Name and domain are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await apiRequest<Website>('/websites', {
        method: 'POST',
        body: JSON.stringify({ name, domain }),
      })
      closePanel()
      if (created?.id) {
        navigate(`/dashboard/settings/websites/${created.id}`)
      } else {
        await loadWebsites()
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to create website.')
    } finally {
      setSaving(false)
    }
  }

  const panelOpen = panel.kind !== 'closed'

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return '—'
    }
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Header */}
      <div className="h-16 flex items-center justify-between border-b dark:border-gray-700 px-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Websites</h1>
          <DocsLink slug="admin-guide/websites" />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Website
        </Button>
      </div>

      {/* Subtitle + Search */}
      <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage your websites and chat widget configurations.
        </p>
        {websites.length > 0 && (
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
        {error && panel.kind === 'closed' && (
          <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 && !search.trim() ? (
          <div className="py-16 text-center">
            <Globe className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No websites yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-4">Add your first website to start using the chat widget.</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Website
            </Button>
          </div>
        ) : filtered.length === 0 && search.trim() ? (
          <div className="py-16 text-center text-sm text-gray-400">No websites matching &ldquo;{search}&rdquo;</div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Website</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Domain</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-36">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map(website => (
                  <tr
                    key={website.id}
                    onClick={() => navigate(`/dashboard/settings/websites/${website.id}`)}
                    className="cursor-pointer bg-white dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                          {website.widget_config?.header_icon_url ? (
                            <img
                              src={`${API_BASE}${website.widget_config.header_icon_url}`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Globe className="h-3.5 w-3.5 text-white" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{website.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://${website.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        {website.domain}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                      {formatDate(website.created_at)}
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
          <div
            className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10"
            onClick={closePanel}
          />
          <div
            ref={panelRef}
            className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-200"
          >
            {/* Panel header */}
            <div className="h-16 flex items-center justify-between px-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">New Website</h2>
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

              <div className="flex flex-col items-center pb-2">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center ring-4 ring-gray-100 dark:ring-gray-700">
                  <Globe className="h-7 w-7 text-white" />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Configure details after creation</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Website Name</label>
                <Input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="My Website"
                  className="dark:bg-gray-800 dark:border-gray-700"
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">A friendly name to identify this website.</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Domain</label>
                <Input
                  value={formDomain}
                  onChange={e => setFormDomain(e.target.value)}
                  placeholder="example.com"
                  className="dark:bg-gray-800 dark:border-gray-700"
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">The domain where the chat widget will be embedded.</p>
              </div>
            </div>

            {/* Panel footer */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 flex-shrink-0">
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={closePanel}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={saving || !formName.trim() || !formDomain.trim()}
                >
                  {saving ? 'Creating…' : 'Create Website'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
