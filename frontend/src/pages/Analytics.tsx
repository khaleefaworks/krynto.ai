import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { API_BASE } from '@/config/endpoints'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import DocsLink from '@/components/DocsLink'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Website {
  id: number
  name: string
  domain: string
}

interface KpiMetric {
  value: number | null
  previous: number | null
  change_pct: number | null
}

interface SplitMetric {
  agent: KpiMetric
  bot?: KpiMetric
}

interface OverviewData {
  period: { start: string; end: string }
  previous_period: { start: string; end: string }
  new_conversations: SplitMetric
  resolved_conversations: SplitMetric
  avg_first_response_seconds: SplitMetric
}

interface ChartPoint {
  date: string
  value: number
}

interface AgentStat {
  id: number
  name: string
  email: string
  role: string
  conversations_handled: number
  messages_sent: number
  avg_first_response_seconds: number | null
}

interface TagStat {
  id: number
  name: string
  color: string
  usage_count: number
}

interface TeamStat {
  id: number
  name: string
  website_name: string
  conversations: number
  resolved: number
  avg_response_seconds: number | null
}

interface RatingSummary {
  total: number
  good: number
  neutral: number
  bad: number
  good_pct: number
  neutral_pct: number
  bad_pct: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dateNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

const PRESET_RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

const TAG_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiRow({ label, metric, format = 'number', labelColor }: {
  label: string
  metric: KpiMetric
  format?: 'number' | 'duration'
  labelColor: string
}) {
  const display = format === 'duration' ? formatDuration(metric.value) : (metric.value ?? 0).toLocaleString()
  const prevDisplay = format === 'duration' ? formatDuration(metric.previous) : (metric.previous ?? 0).toLocaleString()
  const pct = metric.change_pct

  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${labelColor}`} />
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">{label}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-base font-bold text-gray-900 dark:text-white tabular-nums">{display}</span>
        {pct !== null && (
          <span className={`inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded ${
            pct > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : pct < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {pct > 0 ? '↑' : pct < 0 ? '↓' : '→'}{Math.abs(pct)}%
          </span>
        )}
        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
          vs {prevDisplay}
        </span>
      </div>
    </div>
  )
}

function SplitKpiCard({ title, agentMetric, botMetric, format = 'number' }: {
  title: string
  agentMetric: KpiMetric
  botMetric?: KpiMetric
  format?: 'number' | 'duration'
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{title}</p>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        <KpiRow label="Agents" metric={agentMetric} format={format} labelColor="bg-blue-500" />
        {botMetric
          ? <KpiRow label="Bot" metric={botMetric} format={format} labelColor="bg-purple-500" />
          : (
            <div className="flex items-center justify-between gap-2 py-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Bot</span>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500 italic">automated — n/a</span>
            </div>
          )
        }
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h3>
      <div className="h-64">
        {children}
      </div>
    </div>
  )
}

function ConversationChart({ data, color, label }: { data: ChartPoint[]; color: string; label: string }) {
  const chartData = data.map(d => ({ date: formatDate(d.date), value: d.value }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
        <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '8px',
            color: '#f9fafb',
            fontSize: '12px',
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#gradient-${label})`}
          name={label}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ResponseTimeChart({ data }: { data: ChartPoint[] }) {
  const chartData = data.map(d => ({
    date: formatDate(d.date),
    value: Math.round(d.value),
  }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
        <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => formatDuration(v as number)} width={55} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '8px',
            color: '#f9fafb',
            fontSize: '12px',
          }}
          formatter={(val) => [formatDuration(val as number), 'Response Time']}
        />
        <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Median Response Time" />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const VALID_TABS = ['conversations', 'agents', 'tags', 'ratings', 'teams', 'bot', 'availability'] as const
type AnalyticsTab = typeof VALID_TABS[number]

export default function Analytics() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [websites, setWebsites] = useState<Website[]>([])
  const [selectedWebsite, setSelectedWebsite] = useState<number | ''>('')
  const [dateRange, setDateRange] = useState(30)

  const rawTab = searchParams.get('tab') ?? ''
  const activeTab: AnalyticsTab = (VALID_TABS as readonly string[]).includes(rawTab) ? rawTab as AnalyticsTab : 'conversations'

  const setActiveTab = (tab: AnalyticsTab) => {
    setSearchParams(prev => { prev.set('tab', tab); return prev }, { replace: true })
  }

  // Data
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [newChart, setNewChart] = useState<ChartPoint[]>([])
  const [resolvedChart, setResolvedChart] = useState<ChartPoint[]>([])
  const [repliedChart, setRepliedChart] = useState<ChartPoint[]>([])
  const [responseChart, setResponseChart] = useState<ChartPoint[]>([])
  const [agents, setAgents] = useState<AgentStat[]>([])
  const [tags, setTags] = useState<TagStat[]>([])
  const [ratings, setRatings] = useState<RatingSummary | null>(null)
  const [teams, setTeams] = useState<TeamStat[]>([])
  const [loading, setLoading] = useState(true)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [modalExportType, setModalExportType] = useState<'report' | 'transcripts'>('report')
  const [modalWebsite, setModalWebsite] = useState<number | ''>(selectedWebsite)
  const [modalStartDate, setModalStartDate] = useState<string>('')
  const [modalEndDate, setModalEndDate] = useState<string>('')
  const [modalAgentId, setModalAgentId] = useState<number | ''>('')
  const [modalTeamId, setModalTeamId] = useState<number | ''>('')
  const [modalTagIds, setModalTagIds] = useState<number[]>([])
  const [modalRating, setModalRating] = useState<string>('')
  const [downloading, setDownloading] = useState(false)

  // Team filter (per-website scope)
  const [selectedTeam, setSelectedTeam] = useState<number | ''>('')
  const [botNewChart, setBotNewChart] = useState<ChartPoint[]>([])
  const [botResolvedChart, setBotResolvedChart] = useState<ChartPoint[]>([])

  // Filter metadata for download modal
  const [allAgents, setAllAgents] = useState<AgentStat[]>([])
  const [allTags, setAllTags] = useState<TagStat[]>([])
  const [allTeams, setAllTeams] = useState<{ id: number; name: string; website_id: number }[]>([])

  // Availability analytics state (2A / 2B / 2C)
  const [availDay, setAvailDay] = useState<string>(todayStr())
  const [availLoading, setAvailLoading] = useState(false)
  const [availData, setAvailData] = useState<any>(null)

  const startDate = dateNDaysAgo(dateRange - 1)
  const endDate = todayStr()

  // Load websites list + filter metadata for download modal
  useEffect(() => {
    apiRequest<Website[]>('/websites').then(setWebsites).catch(() => { })
    apiRequest<{ agents: AgentStat[] }>('/analytics/agents/summary?start=2000-01-01&end=2099-12-31')
      .then(d => setAllAgents(Array.isArray(d?.agents) ? d.agents : [])).catch(() => { })
    apiRequest<{ tags: TagStat[] }>('/analytics/tags/summary?start=2000-01-01&end=2099-12-31')
      .then(d => setAllTags(Array.isArray(d?.tags) ? d.tags : [])).catch(() => { })
    apiRequest<any[]>('/teams/overview')
      .then(d => setAllTeams(Array.isArray(d) ? d.flatMap((w: any) => w.teams || []).map((t: any) => ({ id: t.id, name: t.name, website_id: t.website_id })) : [])).catch(() => { })
  }, [])

  // Build query string
  const qs = useCallback(() => {
    const params = new URLSearchParams()
    params.set('start', startDate)
    params.set('end', endDate)
    if (selectedWebsite) params.set('website_id', String(selectedWebsite))
    if (selectedTeam) params.set('team_id', String(selectedTeam))
    return params.toString()
  }, [startDate, endDate, selectedWebsite, selectedTeam])

  // Load data on filter change
  useEffect(() => {
    setLoading(true)
    const q = qs()

    const botQ = q + (q ? '&' : '') + 'bot_only=true'
    Promise.all([
      apiRequest<OverviewData>(`/analytics/overview?${q}`),
      apiRequest<{ series: ChartPoint[] }>(`/analytics/conversations/new?${q}`),
      apiRequest<{ series: ChartPoint[] }>(`/analytics/conversations/resolved?${q}`),
      apiRequest<{ series: ChartPoint[] }>(`/analytics/conversations/replied?${q}`),
      apiRequest<{ series: ChartPoint[] }>(`/analytics/conversations/response-time?${q}`),
      apiRequest<{ agents: AgentStat[] }>(`/analytics/agents/summary?${q}`),
      apiRequest<{ tags: TagStat[] }>(`/analytics/tags/summary?${q}`),
      apiRequest<RatingSummary>(`/analytics/ratings/summary?${q}`),
      apiRequest<{ teams: TeamStat[] }>(`/analytics/teams/summary?${q}`),
      apiRequest<{ series: ChartPoint[] }>(`/analytics/conversations/new?${botQ}`),
      apiRequest<{ series: ChartPoint[] }>(`/analytics/conversations/resolved?${botQ}`),
    ])
      .then(([ov, nc, rc, rpc, rt, ag, tg, rs, tm, bnc, brc]) => {
        setOverview(ov)
        setNewChart(nc.series)
        setResolvedChart(rc.series)
        setRepliedChart(rpc.series)
        setResponseChart(rt.series)
        setAgents(ag.agents)
        setTags(tg.tags)
        setRatings(rs)
        setTeams(Array.isArray(tm?.teams) ? tm.teams : [])
        setBotNewChart(bnc.series)
        setBotResolvedChart(brc.series)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [qs])

  // Fetch availability data when the availability tab is active or filters change
  useEffect(() => {
    if (activeTab !== 'availability') return
    setAvailLoading(true)
    apiRequest<any>(`/analytics/agent-availability?day=${availDay}`)
      .then(av => setAvailData(av))
      .catch(console.error)
      .finally(() => setAvailLoading(false))
  }, [activeTab, availDay, selectedWebsite])

  return (
    <>
      <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 sm:h-16 sm:flex sm:items-center bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 sm:py-0 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Analytics</h1>
                <DocsLink slug="admin-guide/analytics" />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Monitor conversations, agent performance, and tag usage
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Website filter */}
              <select
                value={selectedWebsite}
                onChange={e => {
                  setSelectedWebsite(e.target.value ? Number(e.target.value) : '')
                  setSelectedTeam('')
                }}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Websites</option>
                {websites.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {/* Team filter — only show when a website is selected */}
              {selectedWebsite !== '' && (
                <select
                  value={selectedTeam}
                  onChange={e => setSelectedTeam(e.target.value ? Number(e.target.value) : '')}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Teams</option>
                  {allTeams
                    .filter(t => t.website_id === selectedWebsite)
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
              )}
              {/* Date range */}
              <select
                value={dateRange}
                onChange={e => setDateRange(Number(e.target.value))}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {PRESET_RANGES.map(r => (
                  <option key={r.days} value={r.days}>{r.label}</option>
                ))}
              </select>
              <button
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 w-full sm:w-auto"
                onClick={() => {
                  setModalExportType('report')
                  setModalWebsite(selectedWebsite)
                  setModalStartDate(startDate)
                  setModalEndDate(endDate)
                  setModalAgentId('')
                  setModalTeamId('')
                  setModalTagIds([])
                  setModalRating('')
                  setShowDownloadModal(true)
                }}
              >
                Download Report
              </button>
              <button
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 w-full sm:w-auto"
                onClick={() => {
                  setModalExportType('transcripts')
                  setModalWebsite(selectedWebsite)
                  setModalStartDate(startDate)
                  setModalEndDate(endDate)
                  setModalAgentId('')
                  setModalTeamId('')
                  setModalTagIds([])
                  setModalRating('')
                  setShowDownloadModal(true)
                }}
              >
                Download Transcripts
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading && !overview ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : (
          <>
            {/* KPI Cards — each shows agent vs bot split */}
            {overview && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <SplitKpiCard
                  title="New Conversations"
                  agentMetric={overview.new_conversations.agent}
                  botMetric={overview.new_conversations.bot}
                />
                <SplitKpiCard
                  title="Resolved Conversations"
                  agentMetric={overview.resolved_conversations.agent}
                  botMetric={overview.resolved_conversations.bot}
                />
                <SplitKpiCard
                  title="Avg. First Response"
                  agentMetric={overview.avg_first_response_seconds.agent}
                  format="duration"
                />
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-200/60 dark:bg-gray-800 p-1 rounded-lg w-fit flex-wrap">
              {(['conversations', 'agents', 'tags', 'ratings', 'teams', 'bot', 'availability'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as typeof activeTab)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === tab
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                >
                  {tab === 'bot' ? 'Bot' : tab === 'availability' ? 'Availability' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Conversations Tab */}
            {activeTab === 'conversations' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="New Conversations">
                  <ConversationChart data={newChart} color="#3b82f6" label="New" />
                </ChartCard>
                <ChartCard title="Resolved Conversations">
                  <ConversationChart data={resolvedChart} color="#10b981" label="Resolved" />
                </ChartCard>
                <ChartCard title="Replied Conversations">
                  <ConversationChart data={repliedChart} color="#f59e0b" label="Replied" />
                </ChartCard>
                <ChartCard title="Response Time (Median)">
                  <ResponseTimeChart data={responseChart} />
                </ChartCard>
              </div>
            )}

            {/* Agents Tab */}
            {activeTab === 'agents' && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Agent Performance</h3>
                </div>
                {agents.length === 0 ? (
                  <div className="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                    No agent data available for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="px-5 py-3">Agent</th>
                          <th className="px-5 py-3">Role</th>
                          <th className="px-5 py-3 text-right">Conversations</th>
                          <th className="px-5 py-3 text-right">Messages Sent</th>
                          <th className="px-5 py-3 text-right">Avg. Response</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {agents.map(agent => (
                          <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-5 py-3">
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">{agent.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{agent.email}</p>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${agent.role === 'system_manager' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                : agent.role === 'manager' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                }`}>
                                {agent.role === 'system_manager' ? 'Admin' : agent.role === 'manager' ? 'Manager' : 'Agent'}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right text-sm text-gray-900 dark:text-white font-medium">
                              {agent.conversations_handled}
                            </td>
                            <td className="px-5 py-3 text-right text-sm text-gray-900 dark:text-white">
                              {agent.messages_sent}
                            </td>
                            <td className="px-5 py-3 text-right text-sm text-gray-900 dark:text-white">
                              {formatDuration(agent.avg_first_response_seconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tags Tab */}
            {activeTab === 'tags' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Tags table */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tag Usage</h3>
                  </div>
                  {tags.length === 0 ? (
                    <div className="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                      No tag data available for this period.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {tags.map((tag, i) => (
                        <div key={tag.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-400 dark:text-gray-500 w-5 text-right">{i + 1}</span>
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: tag.color || '#6b7280' }}
                            />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{tag.name}</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            {tag.usage_count}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tags pie chart */}
                <ChartCard title="Tag Distribution">
                  {tags.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
                      No tag data available
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={tags.slice(0, 10).map(t => ({ name: t.name, value: t.usage_count }))}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                          labelLine={false}
                        >
                          {tags.slice(0, 10).map((t, i) => (
                            <Cell key={t.id} fill={t.color || TAG_COLORS[i % TAG_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1f2937',
                            border: '1px solid #374151',
                            borderRadius: '8px',
                            color: '#f9fafb',
                            fontSize: '12px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </div>
            )}

            {/* Teams Tab */}
            {activeTab === 'teams' && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Team Performance</h3>
                </div>
                {teams.length === 0 ? (
                  <div className="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                    No team data available for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="px-5 py-3">Team</th>
                          <th className="px-5 py-3">Website</th>
                          <th className="px-5 py-3 text-right">Conversations</th>
                          <th className="px-5 py-3 text-right">Resolved</th>
                          <th className="px-5 py-3 text-right">Avg. Response</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {teams.map(team => (
                          <tr key={team.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{team.name}</td>
                            <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">{team.website_name}</td>
                            <td className="px-5 py-3 text-right text-sm text-gray-900 dark:text-white font-medium">{team.conversations}</td>
                            <td className="px-5 py-3 text-right text-sm text-gray-900 dark:text-white">{team.resolved}</td>
                            <td className="px-5 py-3 text-right text-sm text-gray-900 dark:text-white">{formatDuration(team.avg_response_seconds)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Ratings Tab */}
            {activeTab === 'ratings' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Rating Summary Cards */}
                <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-center">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Total Ratings</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{ratings?.total ?? 0}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-center">
                    <p className="text-2xl mb-1">&#x1F60A;</p>
                    <p className="text-xl font-bold text-green-600 dark:text-green-400">{ratings?.good ?? 0}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Good ({ratings?.good_pct ?? 0}%)</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-center">
                    <p className="text-2xl mb-1">&#x1F610;</p>
                    <p className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{ratings?.neutral ?? 0}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Neutral ({ratings?.neutral_pct ?? 0}%)</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-center">
                    <p className="text-2xl mb-1">&#x1F61E;</p>
                    <p className="text-xl font-bold text-red-600 dark:text-red-400">{ratings?.bad ?? 0}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Bad ({ratings?.bad_pct ?? 0}%)</p>
                  </div>
                </div>

                {/* Satisfaction bar */}
                {ratings && ratings.total > 0 && (
                  <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Satisfaction Distribution</h3>
                    <div className="flex rounded-full overflow-hidden h-8">
                      {ratings.good > 0 && (
                        <div
                          className="bg-green-500 flex items-center justify-center text-white text-xs font-semibold transition-all"
                          style={{ width: `${ratings.good_pct}%` }}
                        >
                          {ratings.good_pct}%
                        </div>
                      )}
                      {ratings.neutral > 0 && (
                        <div
                          className="bg-yellow-400 flex items-center justify-center text-gray-800 text-xs font-semibold transition-all"
                          style={{ width: `${ratings.neutral_pct}%` }}
                        >
                          {ratings.neutral_pct}%
                        </div>
                      )}
                      {ratings.bad > 0 && (
                        <div
                          className="bg-red-500 flex items-center justify-center text-white text-xs font-semibold transition-all"
                          style={{ width: `${ratings.bad_pct}%` }}
                        >
                          {ratings.bad_pct}%
                        </div>
                      )}
                    </div>
                    <div className="flex justify-center gap-6 mt-3 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Good</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" /> Neutral</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Bad</span>
                    </div>
                  </div>
                )}
                {(!ratings || ratings.total === 0) && (
                  <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center text-gray-400 dark:text-gray-500">
                    No ratings received for this period.
                  </div>
                )}
              </div>
            )}

            {/* Bot Tab */}
            {activeTab === 'bot' && (
              <div className="space-y-4">
                {/* Bot summary row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Bot Conversations</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {(overview?.new_conversations.bot?.value ?? 0).toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">visitor-initiated bot flows</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Auto-Resolved</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {(overview?.resolved_conversations.bot?.value ?? 0).toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">closed automatically by bot</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Auto-Resolve Rate</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {(() => {
                        const total = overview?.new_conversations.bot?.value ?? 0
                        const resolved = overview?.resolved_conversations.bot?.value ?? 0
                        return total > 0 ? `${Math.round((resolved / total) * 100)}%` : '—'
                      })()}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">of bot flows completed</p>
                  </div>
                </div>
                {/* Bot conversation charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title="Bot Conversations (Daily)">
                    <ConversationChart data={botNewChart} color="#8b5cf6" label="Bot" />
                  </ChartCard>
                  <ChartCard title="Bot Auto-Resolved (Daily)">
                    <ConversationChart data={botResolvedChart} color="#a78bfa" label="Bot Resolved" />
                  </ChartCard>
                </div>
              </div>
            )}

            {/* Availability Tab */}
            {activeTab === 'availability' && (
              <div className="space-y-6">
                {/* Availability-specific date filter (website uses the header filter above) */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 dark:text-gray-400 font-medium">Date</label>
                    <input
                      type="date"
                      value={availDay}
                      max={todayStr()}
                      onChange={e => setAvailDay(e.target.value)}
                      className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {availLoading && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
                  )}
                </div>

                {/* 2A — Agent Availability Timeline */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Availability Timeline</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">When each agent marked themselves available/unavailable</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Available</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300 dark:bg-gray-600 inline-block" /> Unavailable</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700 inline-block border border-dashed border-gray-400" /> No data</span>
                    </div>
                  </div>

                  {!availData || availData.agents?.length === 0 ? (
                    <div className="px-5 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      No availability data for this date. Agents need to toggle their availability for it to appear here.
                    </div>
                  ) : (
                    <div className="p-5 space-y-3">
                      {/* Time axis labels */}
                      <div className="flex text-xs text-gray-400 dark:text-gray-500 mb-1 pl-36">
                        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
                          <div key={h} style={{ left: `${(h / 24) * 100}%` }} className="flex-1 text-center first:text-left last:text-right">
                            {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
                          </div>
                        ))}
                      </div>

                      {availData.agents.map((agent: any) => (
                        <div key={agent.agent_id} className="flex items-center gap-3">
                          {/* Agent name */}
                          <div className="w-32 flex-shrink-0 text-right">
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate" title={agent.agent_name}>{agent.agent_name}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">{formatDuration(agent.total_online_seconds)}</p>
                          </div>
                          {/* Timeline bar */}
                          <div className="flex-1 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative flex">
                            {!agent.has_history ? (
                              <div className="flex-1 h-full bg-gray-200 dark:bg-gray-700 border border-dashed border-gray-400 dark:border-gray-500 rounded-lg" title="No availability changes recorded this day" />
                            ) : (
                              agent.segments.map((seg: any, i: number) => {
                                const dayStart = new Date(`${availDay}T00:00:00`).getTime()
                                const dayEnd = new Date(`${availDay}T23:59:59`).getTime()
                                const dayMs = dayEnd - dayStart
                                const segStart = new Date(seg.start + 'Z').getTime()
                                const segEnd = new Date(seg.end + 'Z').getTime()
                                const left = Math.max(0, ((segStart - dayStart) / dayMs) * 100)
                                const width = Math.min(100 - left, ((segEnd - segStart) / dayMs) * 100)
                                const startTime = new Date(seg.start + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                const endTime = new Date(seg.end + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                return (
                                  <div
                                    key={i}
                                    title={`${seg.is_available ? 'Available' : 'Unavailable'}: ${startTime} – ${endTime} (${formatDuration(seg.duration_seconds)})`}
                                    style={{ position: 'absolute', left: `${left}%`, width: `${Math.max(width, 0.5)}%`, top: 0, bottom: 0 }}
                                    className={`${seg.is_available ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'} transition-opacity hover:opacity-80`}
                                  />
                                )
                              })
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </div>
    </div>

      {/* Download Modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowDownloadModal(false)} />
          <div className="relative z-[60] w-full max-w-lg mx-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {modalExportType === 'report' ? 'Download Report' : 'Download Transcripts'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {modalExportType === 'report'
                  ? 'Export conversation analytics as XLSX with optional filters.'
                  : 'Export full conversation transcripts as XLSX.'}
              </p>

              {/* Export type toggle */}
              <div className="mt-4 flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                {(['report', 'transcripts'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setModalExportType(type)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      modalExportType === type
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {type === 'report' ? 'Report (XLSX)' : 'Transcripts (XLSX)'}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {/* Website */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Website</label>
                  <select
                    value={modalWebsite}
                    onChange={e => setModalWebsite(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">All Websites</option>
                    {websites.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>

                {/* Agent */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Agent</label>
                  <select
                    value={modalAgentId}
                    onChange={e => setModalAgentId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">All Agents</option>
                    {allAgents.map(a => (
                      <option key={a.id} value={a.id}>{a.name || a.email}</option>
                    ))}
                  </select>
                </div>

                {/* Team */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Team</label>
                  <select
                    value={modalTeamId}
                    onChange={e => setModalTeamId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">All Teams</option>
                    {allTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* Rating */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Rating</label>
                  <select
                    value={modalRating}
                    onChange={e => setModalRating(e.target.value)}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">All Ratings</option>
                    <option value="1">Positive</option>
                    <option value="0">Neutral</option>
                    <option value="-1">Negative</option>
                  </select>
                </div>

                {/* From */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
                  <input type="date" value={modalStartDate} onChange={e => setModalStartDate(e.target.value)}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                </div>

                {/* To */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
                  <input type="date" value={modalEndDate} onChange={e => setModalEndDate(e.target.value)}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                </div>
              </div>

              {/* Tags multi-select */}
              {allTags.length > 0 && (
                <div className="mt-3">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Tags (filter by — select none for all)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map(tag => {
                      const active = modalTagIds.includes(tag.id)
                      return (
                        <button
                          key={tag.id}
                          onClick={() => setModalTagIds(prev => active ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                            active
                              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {tag.color && <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />}
                          {tag.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setShowDownloadModal(false)}
                  className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-200">
                  Cancel
                </button>
                <Button
                  onClick={async () => {
                    try {
                      setDownloading(true)
                      const params = new URLSearchParams()
                      params.set('start', modalStartDate)
                      params.set('end', modalEndDate)
                      if (modalWebsite) params.set('website_id', String(modalWebsite))
                      if (modalAgentId) params.set('agent_id', String(modalAgentId))
                      if (modalTeamId) params.set('team_id', String(modalTeamId))
                      if (modalRating !== '') params.set('rating', modalRating)
                      if (modalTagIds.length > 0) params.set('tag_ids', modalTagIds.join(','))

                      const endpoint = modalExportType === 'transcripts'
                        ? '/analytics/export_transcripts'
                        : '/analytics/export_xlsx'

                      const token = localStorage.getItem('auth_token')
                      const res = await fetch(`${API_BASE}${endpoint}?${params.toString()}`, {
                        method: 'GET',
                        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                      })

                      if (!res.ok) {
                        const txt = await res.text().catch(() => '')
                        alert('Export failed: ' + (txt || res.statusText))
                        return
                      }

                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      const suffix = modalExportType === 'transcripts' ? 'transcripts' : 'analytics'
                      a.download = `${suffix}_${modalStartDate}_${modalEndDate}.xlsx`
                      document.body.appendChild(a)
                      a.click()
                      a.remove()
                      URL.revokeObjectURL(url)
                      setShowDownloadModal(false)
                    } catch (err) {
                      console.error(err)
                      alert('Export failed')
                    } finally {
                      setDownloading(false)
                    }
                  }}
                  disabled={downloading}
                >
                  {downloading ? 'Preparing…' : 'Download'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
