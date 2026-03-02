import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Plus, ExternalLink, Globe } from 'lucide-react'

interface Website {
  id: number
  name: string
  domain: string
  widget_config: {
    primary_color?: string
    position?: string
  } | null
  created_at: string
}

export default function WebsitesList() {
  const navigate = useNavigate()
  const [websites, setWebsites] = useState<Website[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const handleRowClick = (websiteId: number) => {
    navigate(`/dashboard/settings/websites/${websiteId}`)
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading websites...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <div className="mx-6 mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="h-16 flex items-center justify-between gap-4 border-b dark:border-gray-700 px-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Websites</h1>
        <Button size="sm" onClick={() => navigate('/dashboard/settings/websites/new')} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Website
        </Button>
      </div>

      {websites.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center mx-6 mt-4">
          <Globe className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-2">No websites yet</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            Add your first website to start using the chat widget
          </p>
          <Button size="sm" onClick={() => navigate('/dashboard/settings/websites/new')} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Website
          </Button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mx-6 mt-4">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Website
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Domain
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {websites.map((website) => (
                <tr
                  key={website.id}
                  onClick={() => handleRowClick(website.id)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {website.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <a
                      href={`https://${website.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      {website.domain}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
