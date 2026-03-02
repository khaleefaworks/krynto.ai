import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { Save, Trash2, Globe, Code, Palette, Copy, Check, Bot, Plus, X, Users, Zap, Tag as TagIcon, AlertTriangle } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'
import { automationsApi, type Automation, type AutomationAction } from '@/services/automations'
import { agentAssignmentsApi, type Agent } from '@/services/agentAssignments'

interface Website {
  id: number
  name: string
  domain: string
  widget_key?: string
  widget_config: {
    theme?: string
    position?: string
    welcome_message?: string
    primary_color?: string
    color_mode?: 'solid' | 'gradient'
    gradient_start?: string
    gradient_end?: string
    header_title?: string
    online_status_text?: string
    bubble_text?: string
    show_emoji_picker?: boolean
    show_attachments?: boolean
    branding_text?: string | null
    header_icon_url?: string | null
    office_hours?: any
  } | null
  created_at: string
}

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type OfficeHoursInterval = {
  start: string
  end: string
}

type OfficeHoursSchedule = Record<DayKey, OfficeHoursInterval[]>

type OfficeHoursConfig = {
  enabled: boolean
  timezone: string
  schedule: OfficeHoursSchedule
}

const DEFAULT_OFFICE_HOURS_SCHEDULE: OfficeHoursSchedule = {
  mon: [{ start: '08:00', end: '17:00' }],
  tue: [{ start: '08:00', end: '17:00' }],
  wed: [{ start: '08:00', end: '17:00' }],
  thu: [{ start: '08:00', end: '17:00' }],
  fri: [{ start: '08:00', end: '17:00' }],
  sat: [],
  sun: [],
}

const getBrowserTimeZone = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    // Some environments return deprecated aliases not present in server tzdata.
    if (tz === 'Asia/Calcutta') return 'Asia/Kolkata'
    return tz
  } catch {
    return 'UTC'
  }
}

const coerceOfficeHours = (raw: any): OfficeHoursConfig => {
  const base: OfficeHoursConfig = {
    enabled: false,
    timezone: getBrowserTimeZone(),
    schedule: { ...DEFAULT_OFFICE_HOURS_SCHEDULE },
  }

  if (!raw || typeof raw !== 'object') return base

  const schedule: any = (raw as any).schedule
  const nextSchedule: OfficeHoursSchedule = { ...DEFAULT_OFFICE_HOURS_SCHEDULE }
    ; (Object.keys(nextSchedule) as DayKey[]).forEach((k) => {
      const v = schedule?.[k]
      nextSchedule[k] = Array.isArray(v)
        ? v
          .filter((i: any) => i && typeof i === 'object')
          .map((i: any) => ({ start: String(i.start || '').slice(0, 5), end: String(i.end || '').slice(0, 5) }))
          .filter((i: any) => i.start && i.end)
        : nextSchedule[k]
    })

  return {
    enabled: (raw as any).enabled === true,
    timezone: String((raw as any).timezone || '').trim() || base.timezone,
    schedule: nextSchedule,
  }
}

type TabType = 'installation' | 'settings' | 'widget' | 'automations' | 'teams' | 'shortcuts' | 'tags' | 'danger'

type AutomationsSubTab = 'templates' | 'auto_messages' | 'chatbots'

type BuilderStep = 'pick_type' | 'edit_auto_message'

type BuilderCreateType = 'auto_message' | 'chatbot' | 'ai_assistant'

type AutomationDraft = {
  id?: number
  name: string
  trigger: string
  enabled: boolean
  action_type: 'send_bot_message' | 'emit_system_event'
  action_index?: number
  message: string
  event_type?: string
  delay_seconds?: number
  cooldown_hours?: number
  welcome_delay_seconds?: number
  repeat?: 'once' | 'cooldown' | 'always'
  repeat_cooldown_seconds?: number
}

export default function WebsiteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAppStore()
  const isNew = id === 'new'
  const websiteId = id && id !== 'new' ? parseInt(id) : null
  const [searchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as TabType) || 'installation'
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [widgetKeyCopied, setWidgetKeyCopied] = useState(false)
  const [widgetSnippet, setWidgetSnippet] = useState('')
  const [widgetKey, setWidgetKey] = useState<string | null>(null)
  const [automations, setAutomations] = useState<Automation[]>([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const [automationsError, setAutomationsError] = useState<string | null>(null)
  const [savingAutomationId, setSavingAutomationId] = useState<number | null>(null)
  const [deletingAutomationId, setDeletingAutomationId] = useState<number | null>(null)
  const [automationsSubTab, setAutomationsSubTab] = useState<AutomationsSubTab>('templates')
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderStep, setBuilderStep] = useState<BuilderStep>('pick_type')
  const [builderCreateType, setBuilderCreateType] = useState<BuilderCreateType>('auto_message')
  const [builderDraft, setBuilderDraft] = useState<AutomationDraft | null>(null)
  const [builderSaving, setBuilderSaving] = useState(false)

  // Website shortcuts tab (admin-only)
  type WebsiteShortcut = {
    id: number
    website_id: number
    shortcut: string
    message: string
    is_active: boolean
    created_at: string
    updated_at: string | null
  }

  const [websiteShortcuts, setWebsiteShortcuts] = useState<WebsiteShortcut[]>([])
  const [websiteShortcutsLoading, setWebsiteShortcutsLoading] = useState(false)
  const [websiteShortcutsSaving, setWebsiteShortcutsSaving] = useState(false)
  const [websiteShortcutsError, setWebsiteShortcutsError] = useState<string | null>(null)
  const [newWebsiteShortcut, setNewWebsiteShortcut] = useState('')
  const [newWebsiteShortcutMessage, setNewWebsiteShortcutMessage] = useState('')
  const [newWebsiteShortcutActive, setNewWebsiteShortcutActive] = useState(true)

  // Tags tab (admin-only)
  type WebsiteTag = {
    id: number
    name: string
    color: string
    description: string | null
    website_id: number
    created_at: string
    updated_at: string | null
  }

  const [websiteTags, setWebsiteTags] = useState<WebsiteTag[]>([])
  const [websiteTagsLoading, setWebsiteTagsLoading] = useState(false)
  const [websiteTagsSaving, setWebsiteTagsSaving] = useState(false)
  const [websiteTagsError, setWebsiteTagsError] = useState<string | null>(null)
  const [editingTag, setEditingTag] = useState<Partial<WebsiteTag> | null>(null)

  // Teams tab (admin-only)
  type WebsiteTeam = { id: number; website_id: number; name: string; description?: string | null; member_count: number }
  type WebsiteAgent = { id: number; email: string; name?: string | null; role?: string; is_active?: boolean; assigned_at?: string | null }
  type TeamMembersResponse = { team_id: number; user_ids: number[] }

  const [teams, setTeams] = useState<WebsiteTeam[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [teamsError, setTeamsError] = useState<string | null>(null)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [websiteAgents, setWebsiteAgents] = useState<WebsiteAgent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [allAgents, setAllAgents] = useState<Agent[]>([])
  const [allAgentsLoading, setAllAgentsLoading] = useState(false)
  const [allAgentsError, setAllAgentsError] = useState<string | null>(null)
  const [assigningAgentId, setAssigningAgentId] = useState<number | null>(null)
  const [unassigningAgentId, setUnassigningAgentId] = useState<number | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [selectedTeamMemberIds, setSelectedTeamMemberIds] = useState<number[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersSaving, setMembersSaving] = useState(false)
  const teamMembersLoadSeq = useRef(0)

  const selectedTeam = selectedTeamId ? teams.find((t) => t.id === selectedTeamId) : undefined

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    widget_config: {
      theme: 'dark',
      position: 'bottom-right',
      welcome_message: 'Hi! How can we help you today?',
      primary_color: '#3b82f6',
      color_mode: 'gradient' as 'solid' | 'gradient',
      gradient_start: '#3b82f6',
      gradient_end: '#2563eb',
      header_title: 'How can we help?',
      online_status_text: 'We reply immediately',
      bubble_text: 'Chat',
      show_emoji_picker: true,
      show_attachments: false,
      branding_text: null as string | null,
      header_icon_url: null as string | null,
      office_hours: coerceOfficeHours(null),
    }
  })

  useEffect(() => {
    if (!isNew && id) {
      loadWebsite()
      loadSnippet()
    }
  }, [id, isNew])

  useEffect(() => {
    if (!websiteId) return
    if (activeTab !== 'automations') return
    loadAutomations()
  }, [activeTab, websiteId])

  useEffect(() => {
    if (!websiteId) return
    if (activeTab !== 'teams') return
    if (!isAdmin(user)) return
    loadTeams()
    loadWebsiteAgents()
    loadAllAgents()
  }, [activeTab, websiteId, user])

  useEffect(() => {
    if (!websiteId) return
    if (activeTab !== 'shortcuts') return
    if (!isAdmin(user)) return
    loadWebsiteShortcuts()
  }, [activeTab, websiteId, user])

  useEffect(() => {
    if (!websiteId) return
    if (activeTab !== 'tags') return
    if (!isAdmin(user)) return
    loadWebsiteTags()
  }, [activeTab, websiteId, user])

  const loadWebsiteShortcuts = async () => {
    if (!websiteId) return
    try {
      setWebsiteShortcutsLoading(true)
      setWebsiteShortcutsError(null)
      const data = await apiRequest<WebsiteShortcut[]>(`/websites/${websiteId}/shortcuts`)
      setWebsiteShortcuts(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setWebsiteShortcutsError(err?.message || 'Failed to load website shortcuts')
    } finally {
      setWebsiteShortcutsLoading(false)
    }
  }

  const loadWebsiteTags = async () => {
    if (!websiteId) return
    try {
      setWebsiteTagsLoading(true)
      setWebsiteTagsError(null)
      const data = await apiRequest<WebsiteTag[]>(`/websites/${websiteId}/tags`)
      setWebsiteTags(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setWebsiteTagsError(err?.message || 'Failed to load tags')
    } finally {
      setWebsiteTagsLoading(false)
    }
  }

  const saveWebsiteTag = async () => {
    if (!websiteId || !editingTag) return
    const name = String(editingTag.name || '').trim()
    const color = String(editingTag.color || '').trim() || '#000000'
    const description = editingTag.description ?? ''
    if (!name) {
      setWebsiteTagsError('Tag name is required')
      return
    }
    try {
      setWebsiteTagsSaving(true)
      setWebsiteTagsError(null)
      if (editingTag.id) {
        await apiRequest(`/websites/${websiteId}/tags/${editingTag.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, color, description }),
        })
      } else {
        await apiRequest(`/websites/${websiteId}/tags`, {
          method: 'POST',
          body: JSON.stringify({ name, color, description }),
        })
      }
      setEditingTag(null)
      await loadWebsiteTags()
    } catch (err: any) {
      setWebsiteTagsError(err?.message || 'Failed to save tag')
    } finally {
      setWebsiteTagsSaving(false)
    }
  }

  const deleteWebsiteTag = async (tagId: number) => {
    if (!websiteId) return
    if (!confirm('Delete this tag? It will be removed from all conversations.')) return
    try {
      setWebsiteTagsSaving(true)
      setWebsiteTagsError(null)
      await apiRequest(`/websites/${websiteId}/tags/${tagId}`, { method: 'DELETE' })
      setWebsiteTags((prev) => prev.filter((t) => t.id !== tagId))
      if (editingTag?.id === tagId) setEditingTag(null)
    } catch (err: any) {
      setWebsiteTagsError(err?.message || 'Failed to delete tag')
    } finally {
      setWebsiteTagsSaving(false)
    }
  }

  const handleCreateWebsiteShortcut = async () => {
    if (!websiteId) return
    const shortcut = newWebsiteShortcut.trim()
    const message = newWebsiteShortcutMessage.trim()
    if (!shortcut || !message) {
      setWebsiteShortcutsError('Shortcut and message are required')
      return
    }
    try {
      setWebsiteShortcutsSaving(true)
      setWebsiteShortcutsError(null)
      const created = await apiRequest<WebsiteShortcut>(`/websites/${websiteId}/shortcuts`, {
        method: 'POST',
        body: JSON.stringify({ shortcut, message, is_active: newWebsiteShortcutActive }),
      })
      setWebsiteShortcuts((prev) => [...prev, created])
      setNewWebsiteShortcut('')
      setNewWebsiteShortcutMessage('')
      setNewWebsiteShortcutActive(true)
    } catch (err: any) {
      setWebsiteShortcutsError(err?.message || 'Failed to create shortcut')
    } finally {
      setWebsiteShortcutsSaving(false)
    }
  }

  const handleToggleWebsiteShortcutActive = async (item: WebsiteShortcut, nextActive: boolean) => {
    if (!websiteId) return
    setWebsiteShortcuts((prev) => prev.map((s) => (s.id === item.id ? { ...s, is_active: nextActive } : s)))
    try {
      const updated = await apiRequest<WebsiteShortcut>(`/websites/${websiteId}/shortcuts/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: nextActive }),
      })
      setWebsiteShortcuts((prev) => prev.map((s) => (s.id === item.id ? updated : s)))
    } catch (err: any) {
      setWebsiteShortcuts((prev) => prev.map((s) => (s.id === item.id ? { ...s, is_active: item.is_active } : s)))
      setWebsiteShortcutsError(err?.message || 'Failed to update shortcut')
    }
  }

  const handleDeleteWebsiteShortcut = async (item: WebsiteShortcut) => {
    if (!websiteId) return
    if (!confirm(`Delete shortcut '${item.shortcut}'?`)) return
    setWebsiteShortcutsError(null)
    const prev = websiteShortcuts
    setWebsiteShortcuts((s) => s.filter((x) => x.id !== item.id))
    try {
      await apiRequest<void>(`/websites/${websiteId}/shortcuts/${item.id}`, { method: 'DELETE' })
    } catch (err: any) {
      setWebsiteShortcuts(prev)
      setWebsiteShortcutsError(err?.message || 'Failed to delete shortcut')
    }
  }

  const loadTeams = async () => {
    if (!websiteId) return
    try {
      setTeamsLoading(true)
      setTeamsError(null)
      const data = await apiRequest<WebsiteTeam[]>(`/websites/${websiteId}/teams`)
      setTeams(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setTeamsError(err?.message || 'Failed to load teams')
    } finally {
      setTeamsLoading(false)
    }
  }

  const loadWebsiteAgents = async () => {
    if (!websiteId) return
    try {
      setAgentsLoading(true)
      setAgentsError(null)
      const data = await apiRequest<WebsiteAgent[]>(`/agent-assignments/website/${websiteId}/agents`)
      setWebsiteAgents(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setAgentsError(err?.message || 'Failed to load assigned agents')
    } finally {
      setAgentsLoading(false)
    }
  }

  const loadAllAgents = async () => {
    try {
      setAllAgentsLoading(true)
      setAllAgentsError(null)
      const data = await agentAssignmentsApi.listAgents()
      setAllAgents(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setAllAgentsError(err?.message || 'Failed to load agents')
    } finally {
      setAllAgentsLoading(false)
    }
  }

  const handleAssignWebsiteAgent = async (agentId: number) => {
    if (!websiteId) return
    try {
      setAssigningAgentId(agentId)
      setAllAgentsError(null)
      await agentAssignmentsApi.assignAgentToWebsite(agentId, websiteId)
      await loadWebsiteAgents()
    } catch (err: any) {
      setAllAgentsError(err?.message || 'Failed to assign agent')
    } finally {
      setAssigningAgentId(null)
    }
  }

  const handleUnassignWebsiteAgent = async (agentId: number) => {
    if (!websiteId) return
    try {
      setUnassigningAgentId(agentId)
      setAllAgentsError(null)
      await agentAssignmentsApi.unassignAgentFromWebsite(agentId, websiteId)
      await loadWebsiteAgents()

      // Keep the team membership selection consistent with the currently assigned website agents.
      setSelectedTeamMemberIds((prev) => prev.filter((id) => id !== agentId))
    } catch (err: any) {
      setAllAgentsError(err?.message || 'Failed to unassign agent')
    } finally {
      setUnassigningAgentId(null)
    }
  }

  const loadTeamMembers = async (teamId: number) => {
    if (!websiteId) return
    const seq = ++teamMembersLoadSeq.current
    try {
      setMembersLoading(true)
      const data = await apiRequest<TeamMembersResponse>(`/websites/${websiteId}/teams/${teamId}/members`)
      const ids = Array.isArray(data?.user_ids) ? data.user_ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : []

      // Ignore out-of-order responses when switching teams quickly.
      if (seq !== teamMembersLoadSeq.current) return
      setSelectedTeamMemberIds(ids)
    } catch (err: any) {
      setTeamsError(err?.message || 'Failed to load team members')
    } finally {
      if (seq === teamMembersLoadSeq.current) setMembersLoading(false)
    }
  }

  const handleCreateTeam = async () => {
    if (!websiteId) return
    const name = newTeamName.trim()
    if (!name) {
      setTeamsError('Team name is required')
      return
    }
    try {
      setCreatingTeam(true)
      setTeamsError(null)
      await apiRequest(`/websites/${websiteId}/teams`, {
        method: 'POST',
        body: JSON.stringify({ name, description: newTeamDescription.trim() || null }),
      })
      setNewTeamName('')
      setNewTeamDescription('')
      await loadTeams()
    } catch (err: any) {
      setTeamsError(err?.message || 'Failed to create team')
    } finally {
      setCreatingTeam(false)
    }
  }

  const handleDeleteTeam = async (teamId: number) => {
    if (!websiteId) return
    if (!confirm('Delete this team?')) return
    try {
      setTeamsError(null)
      await apiRequest(`/websites/${websiteId}/teams/${teamId}`, { method: 'DELETE' })
      if (selectedTeamId === teamId) {
        setSelectedTeamId(null)
        setSelectedTeamMemberIds([])
      }
      await loadTeams()
    } catch (err: any) {
      setTeamsError(err?.message || 'Failed to delete team')
    }
  }

  const handleSaveMembers = async () => {
    if (!websiteId || !selectedTeamId) return
    try {
      setMembersSaving(true)
      setTeamsError(null)
      await apiRequest(`/websites/${websiteId}/teams/${selectedTeamId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ user_ids: selectedTeamMemberIds }),
      })

      // Optimistically reflect the count immediately.
      setTeams((prev) => prev.map((t) => (t.id === selectedTeamId ? { ...t, member_count: selectedTeamMemberIds.length } : t)))
      await loadTeams()
      await loadTeamMembers(selectedTeamId)

      setSuccessMessage('Team members saved')
      setTimeout(() => setSuccessMessage(null), 2000)
    } catch (err: any) {
      setTeamsError(err?.message || 'Failed to save members')
    } finally {
      setMembersSaving(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'automations') return
    // Keep the last sub-tab selection, but default to Templates.
    if (!automationsSubTab) setAutomationsSubTab('templates')
  }, [activeTab])

  const loadAutomations = async () => {
    if (!websiteId) return
    try {
      setAutomationsLoading(true)
      setAutomationsError(null)
      const data = await automationsApi.list(websiteId)
      setAutomations(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to load automations')
    } finally {
      setAutomationsLoading(false)
    }
  }

  const updateAutomationLocal = (id: number, updates: Partial<Automation>) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)))
  }

  const extractPrimaryAction = (automation: Automation): AutomationAction | null => {
    const actions = automation.actions
    if (Array.isArray(actions)) {
      const normalized = actions.filter((a) => a && typeof a === 'object') as AutomationAction[]
      return (
        normalized.find((a) => a?.type === 'send_bot_message') ||
        normalized.find((a) => a?.type === 'emit_system_event') ||
        null
      )
    }
    if (actions && typeof actions === 'object') {
      const t = String((actions as any).type || '')
      if (t === 'send_bot_message' || t === 'emit_system_event') return actions as AutomationAction
    }
    return null
  }

  const normalizeAutomationActions = (automation: Automation): AutomationAction[] => {
    const raw = automation.actions
    if (Array.isArray(raw)) {
      return raw.filter((a) => a && typeof a === 'object') as AutomationAction[]
    }
    if (raw && typeof raw === 'object') {
      const t = String((raw as any).type || '')
      if (t === 'send_bot_message' || t === 'emit_system_event') return [raw as AutomationAction]
    }
    return []
  }

  const extractActionText = (action: AutomationAction | null | undefined): string => {
    if (!action) return ''
    const text = action.type === 'emit_system_event' ? (action.content ?? action.message) : action.message
    return typeof text === 'string' ? text : ''
  }

  const updateAutomationAction = (automation: Automation, nextAction: AutomationAction) => {
    const actions = automation.actions
    if (Array.isArray(actions)) {
      const next = actions.map((a) => (a?.type === nextAction.type ? nextAction : a))
      return next
    }
    return nextAction
  }

  const getEffectiveEventType = (trigger: string, action: AutomationAction | null | undefined): string | null => {
    if (!action) return null
    const t = String(trigger || '')

    if (action.type === 'emit_system_event') {
      const raw = (action.event_type ?? '').toString().trim()
      return raw || t || null
    }

    if (action.type === 'send_bot_message') {
      if (t === 'visitor_connected') return 'automation_welcome'
      const raw = (action.event_type ?? '').toString().trim()
      if (raw) return raw

      // Match backend defaults so the warning reflects real idempotency behavior.
      if (t === 'no_agent_assigned_for') return 'bot_waiting'
      if (t === 'website_offline_first_message') return 'bot_offline'
      if (t === 'visitor_closed_chat') return 'bot_visitor_closed'
      if (t === 'conversation_resolved') return 'bot_closing'
      if (t === 'conversation_reopened') return 'bot_reopened'
      return null
    }

    return null
  }

  const getEffectiveEventTypeForDraft = (draft: AutomationDraft | null): string | null => {
    if (!draft) return null
    const trigger = String(draft.trigger || '')
    if (draft.action_type === 'emit_system_event') {
      const raw = String(draft.event_type || '').trim()
      return raw || trigger || null
    }

    // Bot message
    if (trigger === 'visitor_connected') return 'automation_welcome'
    const raw = String(draft.event_type || '').trim()
    if (raw) return raw
    if (trigger === 'no_agent_assigned_for') return 'bot_waiting'
    if (trigger === 'website_offline_first_message') return 'bot_offline'
    if (trigger === 'visitor_closed_chat') return 'bot_visitor_closed'
    if (trigger === 'conversation_resolved') return 'bot_closing'
    if (trigger === 'conversation_reopened') return 'bot_reopened'
    return null
  }

  const enabledEventTypeCollisions = (() => {
    type Ref = {
      automationId: number
      automationName: string
      trigger: string
      idx: number
      actionType: string
      effectiveEventType: string
    }

    const map = new Map<string, Ref[]>()
    for (const automation of automations) {
      if (!automation?.enabled) continue
      const trigger = String(automation.trigger || '')
      const actions = normalizeAutomationActions(automation)
      for (let idx = 0; idx < actions.length; idx++) {
        const action = actions[idx]
        const effectiveEventType = getEffectiveEventType(trigger, action)
        if (!effectiveEventType) continue
        const key = `${trigger}::${effectiveEventType}`
        const arr = map.get(key) || []
        arr.push({
          automationId: automation.id,
          automationName: automation.name,
          trigger,
          idx,
          actionType: action?.type || '',
          effectiveEventType,
        })
        map.set(key, arr)
      }
    }
    return map
  })()

  const getAutomationByTemplate = (template: {
    trigger: string
    action_type: 'send_bot_message' | 'emit_system_event'
    event_type?: string
    name?: string
  }) => {
    const matchesTrigger = automations.filter((a) => a.trigger === template.trigger)
    if (matchesTrigger.length === 0) return null

    const byTypeAndEventType = matchesTrigger.find((a) => {
      const raw = a.actions
      const normalized: AutomationAction[] = Array.isArray(raw)
        ? (raw.filter((x) => x && typeof x === 'object') as AutomationAction[])
        : raw && typeof raw === 'object'
          ? ([raw] as AutomationAction[])
          : ([] as AutomationAction[])

      return normalized.some((action) => {
        if (!action || action.type !== template.action_type) return false
        if (template.event_type) return String(action.event_type || '') === template.event_type
        return true
      })
    })
    if (byTypeAndEventType) return byTypeAndEventType

    if (template.name) {
      const byName = matchesTrigger.find((a) => a.name === template.name)
      if (byName) return byName
    }

    // Important: do not fall back to “any automation with same trigger”.
    // Otherwise Templates will show “Edit” for a different action type
    // (e.g. Closing message exists, so Resolved event incorrectly appears “used”).
    return null
  }

  const draftFromAutomationAction = (
    automation: Automation,
    action: AutomationAction | null,
    actionIndex: number | undefined,
  ): AutomationDraft => {
    const delay = Number(automation.conditions?.delay_seconds ?? 60)
    const cooldownHours = Number(automation.conditions?.cooldown_hours ?? 24)
    const repeat = String(automation.conditions?.repeat || '').trim()
    const repeatCooldownSeconds = Number(
      automation.conditions?.repeat_cooldown_seconds ??
      automation.conditions?.cooldown_seconds ??
      0,
    )

    const repeatMode: AutomationDraft['repeat'] =
      repeat === 'always' || repeat === 'cooldown' || repeat === 'once' ? (repeat as any) : undefined

    return {
      id: automation.id,
      name: automation.name,
      trigger: String(automation.trigger || ''),
      enabled: !!automation.enabled,
      action_type: action?.type === 'emit_system_event' ? 'emit_system_event' : 'send_bot_message',
      action_index: typeof actionIndex === 'number' ? actionIndex : undefined,
      message: extractActionText(action),
      event_type: action?.event_type,
      delay_seconds:
        automation.trigger === 'no_agent_assigned_for' && Number.isFinite(delay) ? Math.max(1, delay) : undefined,
      cooldown_hours:
        automation.trigger === 'visitor_connected' && Number.isFinite(cooldownHours) ? Math.max(1, cooldownHours) : undefined,
      welcome_delay_seconds:
        automation.trigger === 'visitor_connected'
          ? Math.max(0, Number(automation.conditions?.welcome_delay_seconds ?? 3))
          : undefined,
      repeat:
        automation.trigger !== 'no_agent_assigned_for' && automation.trigger !== 'visitor_connected'
          ? (repeatMode || 'once')
          : undefined,
      repeat_cooldown_seconds:
        automation.trigger !== 'no_agent_assigned_for' &&
          automation.trigger !== 'visitor_connected' &&
          repeatMode === 'cooldown' &&
          Number.isFinite(repeatCooldownSeconds)
          ? Math.max(1, repeatCooldownSeconds)
          : undefined,
    }
  }

  const draftFromAutomation = (automation: Automation): AutomationDraft => {
    const action = extractPrimaryAction(automation)
    const actions = normalizeAutomationActions(automation)
    const idx = action ? actions.findIndex((a) => a === action) : -1
    return draftFromAutomationAction(automation, action, idx >= 0 ? idx : undefined)
  }

  const openBuilderPickType = () => {
    setAutomationsError(null)
    setBuilderOpen(true)
    setBuilderStep('pick_type')
    setBuilderCreateType('auto_message')
    setBuilderDraft({
      name: 'New auto message',
      trigger: 'no_agent_assigned_for',
      enabled: true,
      action_type: 'send_bot_message',
      message: '',
      event_type: undefined,
      delay_seconds: 60,
      cooldown_hours: 24,
      repeat: 'once',
      repeat_cooldown_seconds: 3600,
    })
  }

  const openBuilderForAutomation = (automation: Automation) => {
    setAutomationsError(null)
    setBuilderOpen(true)
    setBuilderStep('edit_auto_message')
    setBuilderCreateType('auto_message')
    setBuilderDraft(draftFromAutomation(automation))
  }

  const openBuilderForAutomationAction = (automation: Automation, action: AutomationAction | null, actionIndex: number) => {
    setAutomationsError(null)
    setBuilderOpen(true)
    setBuilderStep('edit_auto_message')
    setBuilderCreateType('auto_message')
    setBuilderDraft(draftFromAutomationAction(automation, action, actionIndex))
  }

  const closeBuilder = () => {
    setBuilderOpen(false)
    setBuilderSaving(false)
    setBuilderDraft(null)
    setBuilderStep('pick_type')
  }

  const saveBuilderDraft = async () => {
    if (!websiteId) return
    if (!builderDraft) return
    if (!builderDraft.message.trim()) {
      setAutomationsError('Message cannot be empty')
      return
    }

    if (builderDraft.action_type === 'emit_system_event') {
      const et = (builderDraft.event_type || '').trim() || builderDraft.trigger
      if (!et) {
        setAutomationsError('Event type is required for system events')
        return
      }
    }

    const isWaiting = builderDraft.trigger === 'no_agent_assigned_for'
    const isWelcome = builderDraft.trigger === 'visitor_connected'
    const canConfigureRepeat = !isWaiting && !isWelcome

    const nextAction: AutomationAction =
      builderDraft.action_type === 'emit_system_event'
        ? {
          type: 'emit_system_event',
          content: builderDraft.message.trim(),
          event_type: (builderDraft.event_type || '').trim() || builderDraft.trigger,
        }
        : {
          type: 'send_bot_message',
          message: builderDraft.message.trim(),
          // Keep stable server-side idempotency for welcome.
          event_type: isWelcome ? 'automation_welcome' : builderDraft.event_type || undefined,
        }

    let nextActions: any = [nextAction]
    if (builderDraft.id) {
      const existing = automations.find((a) => a.id === builderDraft.id) || null
      if (existing && String(existing.trigger || '') === builderDraft.trigger) {
        const existingActions = normalizeAutomationActions(existing)
        const actionIndex = typeof builderDraft.action_index === 'number' ? builderDraft.action_index : -1
        if (actionIndex >= 0 && actionIndex < existingActions.length) {
          nextActions = existingActions.map((a, idx) => (idx === actionIndex ? nextAction : a))
        }
      }
    }

    const payload = {
      name: builderDraft.name.trim() || 'Auto message',
      trigger: builderDraft.trigger,
      enabled: !!builderDraft.enabled,
      conditions:
        isWaiting
          ? { delay_seconds: Math.max(1, Number(builderDraft.delay_seconds ?? 60) || 60) }
          : isWelcome
            ? {
              cooldown_hours: Math.max(1, Number(builderDraft.cooldown_hours ?? 24) || 24),
              welcome_delay_seconds: Math.max(0, Number(builderDraft.welcome_delay_seconds ?? 3) || 0),
            }
            : canConfigureRepeat
              ? {
                repeat: builderDraft.repeat || 'once',
                ...(builderDraft.repeat === 'cooldown'
                  ? {
                    repeat_cooldown_seconds: Math.max(
                      1,
                      Number(builderDraft.repeat_cooldown_seconds ?? 3600) || 3600,
                    ),
                  }
                  : {}),
              }
              : {},
      actions: nextActions,
    }

    try {
      setBuilderSaving(true)
      if (builderDraft.id) {
        await automationsApi.update(builderDraft.id, payload)
      } else {
        await automationsApi.create({
          website_id: websiteId,
          ...payload,
        })
      }
      await loadAutomations()
      closeBuilder()
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to save automation')
    } finally {
      setBuilderSaving(false)
    }
  }

  const saveAutomation = async (automation: Automation) => {
    try {
      setSavingAutomationId(automation.id)
      await automationsApi.update(automation.id, {
        name: automation.name,
        trigger: automation.trigger,
        enabled: automation.enabled,
        conditions: automation.conditions || {},
        actions: automation.actions || {},
      })
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to save automation')
    } finally {
      setSavingAutomationId(null)
    }
  }

  const deleteAutomation = async (automation: Automation) => {
    if (!confirm(`Delete automation "${automation.name}"? This cannot be undone.`)) return
    try {
      setDeletingAutomationId(automation.id)
      await automationsApi.remove(automation.id)
      setAutomations((prev) => prev.filter((a) => a.id !== automation.id))
      if (builderDraft?.id === automation.id) closeBuilder()
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to delete automation')
    } finally {
      setDeletingAutomationId(null)
    }
  }

  const createTemplateIfMissing = async (template: {
    name: string
    trigger: string
    enabled: boolean
    action_type?: 'send_bot_message' | 'emit_system_event'
    message: string
    event_type?: string
    delay_seconds?: number
    cooldown_hours?: number
    repeat?: 'once' | 'cooldown' | 'always'
    repeat_cooldown_seconds?: number
  }) => {
    if (!websiteId) return
    try {
      setAutomationsError(null)
      const existing = getAutomationByTemplate({
        trigger: template.trigger,
        action_type: template.action_type || 'send_bot_message',
        event_type: template.event_type,
        name: template.name,
      })
      if (existing) {
        openBuilderForAutomation(existing)
        return
      }

      const nextActionType = template.action_type || 'send_bot_message'

      const baseConditions =
        template.trigger === 'no_agent_assigned_for'
          ? { delay_seconds: Math.max(1, Number(template.delay_seconds ?? 60) || 60) }
          : template.trigger === 'visitor_connected'
            ? { cooldown_hours: Math.max(1, Number(template.cooldown_hours ?? 24) || 24) }
            : {}

      const nextConditions =
        template.trigger !== 'no_agent_assigned_for' && template.trigger !== 'visitor_connected'
          ? {
            ...baseConditions,
            ...(template.repeat ? { repeat: template.repeat } : {}),
            ...(typeof template.repeat_cooldown_seconds === 'number' && Number.isFinite(template.repeat_cooldown_seconds)
              ? { repeat_cooldown_seconds: Math.max(1, Math.floor(template.repeat_cooldown_seconds)) }
              : {}),
          }
          : baseConditions

      const created = await automationsApi.create({
        website_id: websiteId,
        name: template.name,
        trigger: template.trigger,
        enabled: template.enabled,
        conditions: nextConditions,
        actions:
          nextActionType === 'emit_system_event'
            ? [
              {
                type: 'emit_system_event',
                content: template.message,
                event_type: template.event_type || template.trigger,
              },
            ]
            : [
              {
                type: 'send_bot_message',
                message: template.message,
                event_type: template.trigger === 'visitor_connected' ? 'automation_welcome' : template.event_type,
              },
            ],
      })
      await loadAutomations()
      if (created) openBuilderForAutomation(created)
    } catch (err: any) {
      setAutomationsError(err?.message || 'Failed to create template')
    }
  }



  const loadSnippet = async () => {
    if (!id) return
    try {
      const data = await apiRequest<{ snippet: string }>(`/widget/snippet/${id}`)
      setWidgetSnippet(data.snippet)
    } catch (err: any) {
      console.error('Failed to load snippet:', err)
    }
  }

  const loadWebsite = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiRequest<Website>(`/websites/${id}`)
      setWidgetKey(data.widget_key || null)
      const defaultWelcome = data.widget_config?.welcome_message || 'Hi! How can we help you today?'
      const officeHours = coerceOfficeHours((data.widget_config as any)?.office_hours)
      setFormData({
        name: data.name,
        domain: data.domain,
        widget_config: {
          theme: data.widget_config?.theme || 'dark',
          position: data.widget_config?.position || 'bottom-right',
          welcome_message: defaultWelcome,
          primary_color: data.widget_config?.primary_color || '#3b82f6',
          color_mode: (data.widget_config as any)?.color_mode === 'solid' ? 'solid' : 'gradient',
          gradient_start: (data.widget_config as any)?.gradient_start || '#3b82f6',
          gradient_end: (data.widget_config as any)?.gradient_end || '#2563eb',
          header_title: data.widget_config?.header_title || 'How can we help?',
          online_status_text: data.widget_config?.online_status_text || 'We reply immediately',
          bubble_text: data.widget_config?.bubble_text || 'Chat',
          show_emoji_picker: data.widget_config?.show_emoji_picker !== undefined ? data.widget_config.show_emoji_picker : true,
          show_attachments: data.widget_config?.show_attachments || false,
          branding_text: data.widget_config?.branding_text ?? null,
          header_icon_url: data.widget_config?.header_icon_url ?? null,
          office_hours: officeHours,
        }
      })
    } catch (err: any) {
      setError(err.message || 'Failed to load website')
    } finally {
      setLoading(false)
    }
  }


  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      if (isNew) {
        await apiRequest('/websites', {
          method: 'POST',
          body: JSON.stringify(formData),
        })
        setSuccessMessage('Website created successfully')
        setTimeout(() => navigate('/dashboard/settings/websites'), 1500)
      } else {
        await apiRequest(`/websites/${id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        })
        setSuccessMessage('Website updated successfully')
        await loadWebsite()
        await loadSnippet()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save website')
    } finally {
      setSaving(false)
    }
  }

  const copySnippet = () => {
    navigator.clipboard.writeText(widgetSnippet)
    setSnippetCopied(true)
    setTimeout(() => setSnippetCopied(false), 2000)
  }

  const copyWidgetKey = () => {
    if (!widgetKey) return
    navigator.clipboard.writeText(widgetKey)
    setWidgetKeyCopied(true)
    setTimeout(() => setWidgetKeyCopied(false), 2000)
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this website? This action cannot be undone.')) {
      return
    }

    try {
      setSaving(true)
      await apiRequest(`/websites/${id}`, {
        method: 'DELETE',
      })
      navigate('/dashboard/settings/websites')
    } catch (err: any) {
      setError(err.message || 'Failed to delete website')
      setSaving(false)
    }
  }

  const handleUploadWidgetIcon = async (file: File) => {
    if (!websiteId) return
    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)

      const token = localStorage.getItem('auth_token')
      const form = new FormData()
      form.append('file', file)

      const res = await fetch(`${API_BASE}/websites/${websiteId}/widget-icon/upload`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to upload icon')
      }

      const data = await res.json()
      setFormData((prev) => ({
        ...prev,
        widget_config: {
          ...prev.widget_config,
          header_icon_url: data.header_icon_url ?? prev.widget_config.header_icon_url,
        },
      }))
      setSuccessMessage('Widget icon uploaded successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to upload icon')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-gray-400">Loading website...</div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      {isNew ? (
        <div className="h-14 flex items-center gap-3 border-b dark:border-gray-700 px-6">
          <h1 className="text-base font-semibold text-gray-900 dark:text-white">
            Add New Website
          </h1>
        </div>
      ) : (
        <div className="h-16 flex items-center gap-3 border-b dark:border-gray-700 px-6">
          <div>
            <h1 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
              {formData.name || 'Website'}
            </h1>
            {formData.domain && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{formData.domain}</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mx-6 mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-300">{successMessage}</p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4 max-w-4xl px-6 py-6">
        {/* Installation Tab */}
        {!isNew && activeTab === 'installation' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code className="w-5 h-5" />
                Installation
              </CardTitle>
              <CardDescription>Copy and paste this code into your website before the closing &lt;/body&gt; tag</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Website ID (internal)</p>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">{websiteId ?? '—'}</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Widget Key (public)</p>
                    <Button
                      type="button"
                      onClick={copyWidgetKey}
                      variant="outline"
                      size="sm"
                      disabled={!widgetKey}
                      className="h-7 px-2"
                    >
                      {widgetKeyCopied ? (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100 break-all">
                    {widgetKey || '—'}
                  </p>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700 relative">
                <Button
                  type="button"
                  onClick={copySnippet}
                  className="absolute top-2 right-2"
                  variant="outline"
                  size="sm"
                >
                  {snippetCopied ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
                <pre className="text-sm overflow-x-auto text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap pr-24">
                  {widgetSnippet || 'Loading...'}
                </pre>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                <p className="font-semibold">Installation Instructions:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Copy the code above</li>
                  <li>Paste it into your website's HTML before the closing &lt;/body&gt; tag</li>
                  <li>The chat widget will automatically appear on your website</li>
                  <li>Make sure at least one agent is assigned to this website</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Teams Tab (admin-only) */}
        {!isNew && activeTab === 'teams' && isAdmin(user) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Teams
              </CardTitle>
              <CardDescription>Create website-specific teams and assign members.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {teamsError && (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 text-sm">
                  {teamsError}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-1 space-y-3">
                  <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                    <div className="font-medium text-gray-900 dark:text-gray-100 mb-2">New Team</div>
                    <div className="space-y-2">
                      <Input
                        value={newTeamName}
                        onChange={(e) => setNewTeamName(e.target.value)}
                        placeholder="Team name"
                      />
                      <Textarea
                        value={newTeamDescription}
                        onChange={(e) => setNewTeamDescription(e.target.value)}
                        placeholder="Description (optional)"
                        rows={3}
                      />
                      <Button type="button" onClick={handleCreateTeam} disabled={creatingTeam} className="w-full gap-2">
                        <Plus className="w-4 h-4" />
                        {creatingTeam ? 'Creating...' : 'Create Team'}
                      </Button>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">Teams</div>
                      {teamsLoading && <div className="text-xs text-gray-500">Loading...</div>}
                    </div>
                    {teams.length === 0 && !teamsLoading ? (
                      <div className="text-sm text-gray-600 dark:text-gray-400">No teams yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {teams.map((t) => (
                          <div
                            key={t.id}
                            className={`p-2 rounded border transition-colors cursor-pointer ${selectedTeamId === t.id
                              ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900'
                              }`}
                            onClick={() => {
                              setTeamsError(null)
                              setSelectedTeamId(t.id)
                              setSelectedTeamMemberIds([])
                              loadTeamMembers(t.id)
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{t.member_count} members</div>
                              </div>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteTeam(t.id)
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100">Website assignment</div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            loadWebsiteAgents()
                            loadAllAgents()
                          }}
                        >
                          Refresh
                        </Button>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Assign agents to this website (website-wide access). Team membership is managed below.
                      </div>

                      {allAgentsError && (
                        <div className="mt-2 text-sm text-red-700 dark:text-red-300">{allAgentsError}</div>
                      )}

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Assigned ({websiteAgents.length})
                          </div>
                          {agentsError && (
                            <div className="mb-2 text-sm text-red-700 dark:text-red-300">{agentsError}</div>
                          )}
                          {agentsLoading ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">Loading...</div>
                          ) : websiteAgents.length === 0 ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">No agents assigned yet.</div>
                          ) : (
                            <div className="space-y-2">
                              {websiteAgents.map((a) => (
                                <div key={a.id} className="flex items-center justify-between gap-2 p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
                                  <div className="min-w-0">
                                    <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{a.email}</div>
                                    {a.role && <div className="text-xs text-gray-500 dark:text-gray-400">{a.role}</div>}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={unassigningAgentId === a.id}
                                    onClick={() => handleUnassignWebsiteAgent(a.id)}
                                  >
                                    {unassigningAgentId === a.id ? 'Unassigning…' : 'Unassign'}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Available</div>
                          {allAgentsLoading ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">Loading...</div>
                          ) : (
                            (() => {
                              const assignedIds = new Set(websiteAgents.map((x) => x.id))
                              const candidates = allAgents
                                .filter((u) => !assignedIds.has(u.id))
                                .filter((u) => {
                                  const role = String((u as any).role || '').toLowerCase()
                                  return !role || role === 'agent' || role === 'manager' || role === 'system_manager'
                                })

                              if (candidates.length === 0) {
                                return <div className="text-sm text-gray-600 dark:text-gray-400">No available agents.</div>
                              }

                              return (
                                <div className="space-y-2">
                                  {candidates.map((u) => (
                                    <div key={u.id} className="flex items-center justify-between gap-2 p-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
                                      <div className="min-w-0">
                                        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{u.email}</div>
                                        {(u as any).role && <div className="text-xs text-gray-500 dark:text-gray-400">{String((u as any).role)}</div>}
                                      </div>
                                      <Button
                                        type="button"
                                        size="sm"
                                        disabled={assigningAgentId === u.id}
                                        onClick={() => handleAssignWebsiteAgent(u.id)}
                                      >
                                        {assigningAgentId === u.id ? 'Assigning…' : 'Assign'}
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )
                            })()
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          Members{selectedTeam?.name ? ` — ${selectedTeam.name}` : ''}
                        </div>
                        {membersLoading && <div className="text-xs text-gray-500">Loading...</div>}
                      </div>

                      {!selectedTeamId ? (
                        <div className="text-sm text-gray-600 dark:text-gray-400">Select a team to manage members.</div>
                      ) : (
                        <>
                          {agentsError && (
                            <div className="mb-3 text-sm text-red-700 dark:text-red-300">{agentsError}</div>
                          )}
                          {agentsLoading ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">Loading assigned agents...</div>
                          ) : (
                            <div className="space-y-2 max-h-[420px] overflow-auto pr-2">
                              {websiteAgents.length === 0 ? (
                                <div className="text-sm text-gray-600 dark:text-gray-400">Assign agents above to enable member selection.</div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                                    <div>Team membership (check agents who belong to this team)</div>
                                    <div>Selected: {selectedTeamMemberIds.length}</div>
                                  </div>
                                  {websiteAgents.map((a) => {
                                    const checked = selectedTeamMemberIds.includes(a.id)
                                    const label = a.name ? `${a.name} (${a.email})` : a.email
                                    return (
                                      <label key={a.id} className="flex items-center gap-3 p-2 rounded border border-gray-200 dark:border-gray-800">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={membersLoading || membersSaving}
                                          onChange={(e) => {
                                            const next = e.target.checked
                                              ? Array.from(new Set([...selectedTeamMemberIds, a.id]))
                                              : selectedTeamMemberIds.filter((id) => id !== a.id)
                                            setSelectedTeamMemberIds(next)
                                          }}
                                        />
                                        <div className="flex-1">
                                          <div className="text-sm text-gray-900 dark:text-gray-100">{label}</div>
                                          {a.role && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{a.role}</div>
                                          )}
                                        </div>
                                      </label>
                                    )
                                  })}
                                </>
                              )}
                            </div>
                          )}

                          <div className="mt-4 flex justify-end">
                            <Button
                              type="button"
                              onClick={handleSaveMembers}
                              disabled={!selectedTeamId || membersSaving || membersLoading || agentsLoading}
                              className="gap-2"
                            >
                              <Save className="w-4 h-4" />
                              {membersSaving ? 'Saving...' : 'Save Members'}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Shortcuts Tab (admin-only) */}
        {!isNew && activeTab === 'shortcuts' && isAdmin(user) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                Shortcuts
              </CardTitle>
              <CardDescription>
                Create website-global shortcuts. Agents assigned to this website can use them in Chats.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {websiteShortcutsError && (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 text-sm">
                  {websiteShortcutsError}
                </div>
              )}

              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Create shortcut</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadWebsiteShortcuts}
                    disabled={websiteShortcutsLoading}
                  >
                    {websiteShortcutsLoading ? 'Refreshing…' : 'Refresh'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Shortcut</label>
                    <Input
                      value={newWebsiteShortcut}
                      onChange={(e) => setNewWebsiteShortcut(e.target.value)}
                      placeholder="hello"
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex items-center gap-2">
                      <Switch checked={newWebsiteShortcutActive} onCheckedChange={setNewWebsiteShortcutActive} />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Message</label>
                  <Textarea
                    value={newWebsiteShortcutMessage}
                    onChange={(e) => setNewWebsiteShortcutMessage(e.target.value)}
                    placeholder="Hello! How can I help you today?"
                  />
                </div>

                <div className="mt-4 flex justify-end">
                  <Button type="button" onClick={handleCreateWebsiteShortcut} disabled={websiteShortcutsSaving}>
                    {websiteShortcutsSaving ? 'Saving…' : 'Create'}
                  </Button>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Website shortcuts</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {websiteShortcutsLoading ? 'Loading…' : `${websiteShortcuts.length} total`}
                  </div>
                </div>

                {websiteShortcutsLoading ? (
                  <div className="text-sm text-gray-600 dark:text-gray-400">Loading shortcuts…</div>
                ) : websiteShortcuts.length === 0 ? (
                  <div className="text-sm text-gray-600 dark:text-gray-400">No shortcuts yet.</div>
                ) : (
                  <div className="space-y-3">
                    {[...websiteShortcuts]
                      .sort((a, b) => String(a.shortcut || '').localeCompare(String(b.shortcut || '')))
                      .map((s) => (
                        <div
                          key={s.id}
                          className="flex items-start justify-between gap-4 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <div className="font-mono text-sm text-gray-900 dark:text-gray-100">/{s.shortcut}</div>
                              <div className="flex items-center gap-2">
                                <Switch checked={s.is_active} onCheckedChange={(v) => handleToggleWebsiteShortcutActive(s, v)} />
                                <span className="text-xs text-gray-600 dark:text-gray-400">Active</span>
                              </div>
                            </div>
                            <div className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                              {s.message}
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            <Button variant="ghost" size="sm" type="button" onClick={() => handleDeleteWebsiteShortcut(s)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tags Tab (admin-only) */}
        {!isNew && activeTab === 'tags' && isAdmin(user) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TagIcon className="w-5 h-5" />
                  Tags
                </CardTitle>
                <CardDescription>
                  {websiteTagsLoading ? 'Loading…' : `${websiteTags.length} total`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {websiteTagsError && (
                  <div className="mb-4 rounded-md p-3 text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-200">
                    {websiteTagsError}
                  </div>
                )}

                {websiteTagsLoading ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
                ) : websiteTags.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No tags yet.</div>
                ) : (
                  <div className="space-y-2">
                    {[...websiteTags]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((t) => (
                        <div key={t.id} className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
                          <button
                            type="button"
                            className="flex items-center gap-3 min-w-0 text-left"
                            onClick={() => setEditingTag({ ...t })}
                            disabled={websiteTagsSaving}
                            title="Edit"
                          >
                            <span className="inline-flex h-5 w-5 rounded" style={{ backgroundColor: t.color }} />
                            <span className="font-medium text-gray-900 dark:text-white truncate">{t.name}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {t.description || ''}
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteWebsiteTag(t.id)}
                            disabled={websiteTagsSaving}
                            className="text-red-600 hover:text-red-700"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{editingTag?.id ? 'Edit Tag' : 'Create Tag'}</CardTitle>
                <CardDescription>Tags are scoped to this website.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                  <Input
                    value={String(editingTag?.name || '')}
                    onChange={(e) => setEditingTag({ ...(editingTag || {}), name: e.target.value })}
                    placeholder="e.g. Urgent"
                    disabled={websiteTagsSaving}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={String(editingTag?.color || '#000000')}
                      onChange={(e) => setEditingTag({ ...(editingTag || {}), color: e.target.value })}
                      className="w-10 h-10 p-0 border-0 rounded"
                      disabled={websiteTagsSaving}
                    />
                    <Input
                      value={String(editingTag?.color || '#000000')}
                      onChange={(e) => setEditingTag({ ...(editingTag || {}), color: e.target.value })}
                      placeholder="#000000"
                      disabled={websiteTagsSaving}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
                  <Input
                    value={String(editingTag?.description || '')}
                    onChange={(e) => setEditingTag({ ...(editingTag || {}), description: e.target.value })}
                    placeholder="What is this tag used for?"
                    disabled={websiteTagsSaving}
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingTag(null)}
                    disabled={websiteTagsSaving}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    onClick={saveWebsiteTag}
                    disabled={websiteTagsSaving}
                  >
                    {websiteTagsSaving ? 'Saving…' : (editingTag?.id ? 'Save' : 'Create')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Automations Tab */}
        {!isNew && activeTab === 'automations' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Automations
              </CardTitle>
              <CardDescription>Configure per-website auto messages and triggers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={automationsSubTab === 'templates' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAutomationsSubTab('templates')}
                  >
                    Templates
                  </Button>
                  <Button
                    type="button"
                    variant={automationsSubTab === 'auto_messages' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAutomationsSubTab('auto_messages')}
                  >
                    Auto messages
                  </Button>
                  <Button
                    type="button"
                    variant={automationsSubTab === 'chatbots' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAutomationsSubTab('chatbots')}
                  >
                    Chatbots
                  </Button>
                </div>

                <Button type="button" size="sm" onClick={openBuilderPickType} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Build from scratch
                </Button>
              </div>

              {automationsError && (
                <div className="p-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
                  {automationsError}
                </div>
              )}

              {automationsLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading automations…</div>
              ) : automationsSubTab === 'templates' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(() => {
                      const t = {
                        name: 'Welcome message',
                        trigger: 'visitor_connected',
                        enabled: true,
                        action_type: 'send_bot_message',
                        cooldown_hours: 24,
                        message: 'Hi! How can we help you today?',
                        event_type: 'automation_welcome',
                        description: 'Sends when a visitor opens the widget, with a cooldown.',
                      } as const
                      const existing = getAutomationByTemplate(t)
                      return (
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Trigger: {t.trigger}</div>
                            </div>
                            {existing ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => openBuilderForAutomation(existing)}>
                                Edit
                              </Button>
                            ) : (
                              <Button type="button" size="sm" onClick={() => createTemplateIfMissing(t)}>
                                Use template
                              </Button>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">{t.description}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-500">
                            Status: {existing ? (existing.enabled ? 'Enabled' : 'Disabled') : 'Not added'}
                          </div>
                        </div>
                      )
                    })()}

                    {(
                      [
                        {
                          name: 'Waiting message',
                          trigger: 'no_agent_assigned_for',
                          enabled: true,
                          action_type: 'send_bot_message',
                          delay_seconds: 60,
                          message: 'Thanks! An agent will be with you shortly.',
                          event_type: 'bot_waiting',
                          description: 'Sends after the visitor waits without an assigned agent.',
                        },
                        {
                          name: 'Offline prompt',
                          trigger: 'website_offline_first_message',
                          enabled: true,
                          action_type: 'send_bot_message',
                          message:
                            "We're busy at the moment. Sorry about that. Leave us your email, and we will contact you as soon as possible.",
                          event_type: 'bot_offline',
                          description: 'Sends when the website is offline and the visitor sends the first message.',
                        },
                        {
                          name: 'Visitor closed message',
                          trigger: 'visitor_closed_chat',
                          enabled: false,
                          action_type: 'send_bot_message',
                          message: 'Thanks! If you need anything else, just send another message.',
                          event_type: 'bot_visitor_closed',
                          description: 'Optional message when a visitor ends the chat UI (does not resolve the conversation).',
                        },
                        {
                          name: 'Visitor closed event',
                          trigger: 'visitor_closed_chat',
                          enabled: true,
                          action_type: 'emit_system_event',
                          message: 'Visitor closed chat.',
                          event_type: 'visitor_closed_chat',
                          description: 'System event shown in the timeline when a visitor ends the chat UI (conversation remains open).',
                        },
                        {
                          name: 'Visitor connected event',
                          trigger: 'visitor_socket_connected',
                          enabled: false,
                          action_type: 'emit_system_event',
                          message: 'Visitor has just connected.',
                          event_type: 'visitor_socket_connected',
                          description: 'Internal timeline event when the visitor opens/reconnects (not shown to the visitor).',
                          repeat: 'cooldown',
                          repeat_cooldown_seconds: 10,
                        },
                        {
                          name: 'Visitor left website event',
                          trigger: 'visitor_left_website',
                          enabled: true,
                          action_type: 'emit_system_event',
                          message: 'Visitor left website.',
                          event_type: 'visitor_left_website',
                          description: 'Internal timeline event when the visitor closes the tab or navigates away (best-effort).',
                          repeat: 'cooldown',
                          repeat_cooldown_seconds: 10,
                        },
                        {
                          name: 'Closing message',
                          trigger: 'conversation_resolved',
                          enabled: false,
                          action_type: 'send_bot_message',
                          message: 'Thanks! This conversation is now closed.',
                          event_type: 'bot_closing',
                          description: 'Optional message sent after a conversation is resolved.',
                        },
                        {
                          name: 'Resolved event',
                          trigger: 'conversation_resolved',
                          enabled: false,
                          action_type: 'emit_system_event',
                          message: 'This conversation has been resolved.',
                          event_type: 'conversation_resolved',
                          description: 'Optional system event shown in the timeline when a conversation is resolved.',
                        },
                        {
                          name: 'Reopened event',
                          trigger: 'conversation_reopened',
                          enabled: false,
                          action_type: 'emit_system_event',
                          message: 'This conversation has been reopened.',
                          event_type: 'conversation_reopened',
                          description: 'Optional system event shown in the timeline when a resolved conversation is reopened.',
                        },
                      ] as const
                    ).map((t) => {
                      const existing = getAutomationByTemplate(t)
                      return (
                        <div
                          key={`${t.trigger}:${t.action_type}:${t.event_type || ''}`}
                          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Trigger: {t.trigger}</div>
                            </div>
                            {existing ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => openBuilderForAutomation(existing)}>
                                Edit
                              </Button>
                            ) : (
                              <Button type="button" size="sm" onClick={() => createTemplateIfMissing(t)}>
                                Use template
                              </Button>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">{t.description}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-500">
                            Status: {existing ? (existing.enabled ? 'Enabled' : 'Disabled') : 'Not added'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : automationsSubTab === 'auto_messages' ? (
                automations.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    No DB-backed auto messages found. Use Templates or Build from scratch.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(() => {
                      const rows = automations.flatMap((automation) => {
                        const actions = normalizeAutomationActions(automation)
                        if (actions.length === 0) {
                          return [{ automation, action: null as AutomationAction | null, idx: -1, showControls: true }]
                        }
                        return actions.map((action, idx) => ({
                          automation,
                          action,
                          idx,
                          showControls: idx === 0,
                        }))
                      })

                      return rows.map(({ automation, action, idx, showControls }) => {
                        const delay = Number(automation.conditions?.delay_seconds ?? 60)
                        const cooldown = Number(automation.conditions?.cooldown_hours ?? 24)
                        const actionTypeLabel = action?.type === 'emit_system_event' ? 'System event' : 'Bot message'
                        const text = extractActionText(action)
                        const eventType = action?.event_type ? String(action.event_type) : ''
                        const effectiveEventType = getEffectiveEventType(String(automation.trigger || ''), action)
                        const collisionKey = effectiveEventType ? `${String(automation.trigger || '')}::${effectiveEventType}` : null
                        const collisions = collisionKey ? enabledEventTypeCollisions.get(collisionKey) || [] : []
                        const hasCollision = collisions.length > 1

                        return (
                          <div
                            key={`${automation.id}:${idx}:${action?.type || 'none'}:${eventType}`}
                            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{automation.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">Trigger: {automation.trigger}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">Action: {actionTypeLabel}{eventType ? ` • event_type: ${eventType}` : ''}</div>
                                {hasCollision && (
                                  <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 rounded-md p-2">
                                    <span className="font-medium">Warning:</span> Duplicate event_type for this trigger. Only one message/event may fire per conversation due to idempotency.
                                  </div>
                                )}
                                {automation.trigger === 'no_agent_assigned_for' && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Delay: {Number.isFinite(delay) ? delay : 60}s</div>
                                )}
                                {automation.trigger === 'visitor_connected' && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    Cooldown: {Number.isFinite(cooldown) ? cooldown : 24}h
                                  </div>
                                )}
                                {text && <div className="text-xs text-gray-600 dark:text-gray-400">{text}</div>}
                              </div>

                              <div className="flex items-center gap-3">
                                {showControls ? (
                                  <Switch
                                    checked={automation.enabled}
                                    onCheckedChange={(checked) => {
                                      const next = { ...automation, enabled: checked }
                                      updateAutomationLocal(automation.id, { enabled: checked })
                                      saveAutomation(next)
                                    }}
                                  />
                                ) : (
                                  <div className="w-10" />
                                )}

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openBuilderForAutomationAction(automation, action, idx)}
                                >
                                  Edit
                                </Button>

                                {showControls ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => deleteAutomation(automation)}
                                    disabled={deletingAutomationId === automation.id}
                                    className="gap-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    {deletingAutomationId === automation.id ? 'Deleting…' : 'Delete'}
                                  </Button>
                                ) : (
                                  <div className="w-[92px]" />
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Chatbots</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Chatbot builder will be added later. For now, use Auto messages.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {builderOpen && (
          <div className="!mt-0 fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={closeBuilder}
              role="button"
              tabIndex={0}
              aria-label="Close automation builder"
            />
            <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-md">
              <div className="h-full flex flex-col">
                <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {builderDraft?.id
                        ? 'Edit auto message'
                        : 'Build from scratch'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Structured editor (MVP)
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={closeBuilder}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {builderStep === 'pick_type' && (
                    <div className="space-y-4">
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        Choose what you want to build.
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setBuilderCreateType('auto_message')
                            setBuilderStep('edit_auto_message')
                          }}
                          className="text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 hover:bg-gray-50 dark:hover:bg-gray-900"
                        >
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Auto message</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Trigger-based bot message (waiting/offline/closing).
                          </div>
                        </button>

                        <button
                          type="button"
                          disabled
                          className="text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 opacity-60 cursor-not-allowed"
                        >
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Chatbot</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Coming soon.</div>
                        </button>

                        <button
                          type="button"
                          disabled
                          className="text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 opacity-60 cursor-not-allowed"
                        >
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI assistant</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Coming soon.</div>
                        </button>
                      </div>
                    </div>
                  )}

                  {builderStep === 'edit_auto_message' && builderDraft && (
                    <div className="space-y-4">
                      {(() => {
                        const effective = getEffectiveEventTypeForDraft(builderDraft)
                        if (!effective) return null

                        const key = `${String(builderDraft.trigger || '')}::${effective}`
                        const refs = enabledEventTypeCollisions.get(key) || []
                        const others = refs.filter((r) => {
                          if (!builderDraft.id) return true
                          if (typeof builderDraft.action_index === 'number') {
                            return !(r.automationId === builderDraft.id && r.idx === builderDraft.action_index)
                          }
                          return r.automationId !== builderDraft.id
                        })

                        if (others.length === 0) return null

                        const names = Array.from(new Set(others.map((r) => r.automationName))).slice(0, 3)
                        const suffix = others.length > names.length ? '…' : ''
                        return (
                          <div className="text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 rounded-md p-3">
                            <span className="font-medium">Warning:</span> Another enabled automation uses event_type “{effective}” for this trigger ({names.join(', ')}{suffix}). Due to idempotency, only one may run per conversation.
                          </div>
                        )
                      })()}

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-3">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">When</div>
                        <div className="grid grid-cols-1 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                            <Input
                              value={builderDraft.name}
                              onChange={(e) => setBuilderDraft({ ...builderDraft, name: e.target.value })}
                              placeholder="Automation name"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Trigger</label>
                            <select
                              value={builderDraft.trigger}
                              onChange={(e) => {
                                const nextTrigger = e.target.value
                                const isNextWaiting = nextTrigger === 'no_agent_assigned_for'
                                const isNextWelcome = nextTrigger === 'visitor_connected'
                                const nextCanRepeat = !isNextWaiting && !isNextWelcome
                                setBuilderDraft({
                                  ...builderDraft,
                                  trigger: nextTrigger,
                                  delay_seconds: nextTrigger === 'no_agent_assigned_for' ? (builderDraft.delay_seconds ?? 60) : undefined,
                                  cooldown_hours: nextTrigger === 'visitor_connected' ? (builderDraft.cooldown_hours ?? 24) : undefined,
                                  welcome_delay_seconds: nextTrigger === 'visitor_connected' ? (builderDraft.welcome_delay_seconds ?? 3) : undefined,
                                  repeat: nextCanRepeat ? (builderDraft.repeat || 'once') : undefined,
                                  repeat_cooldown_seconds: nextCanRepeat
                                    ? builderDraft.repeat === 'cooldown'
                                      ? (builderDraft.repeat_cooldown_seconds ?? 3600)
                                      : builderDraft.repeat_cooldown_seconds
                                    : undefined,
                                })
                              }}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            >
                              <option value="visitor_connected">Visitor connected</option>
                              <option value="visitor_socket_connected">Visitor (re)connected</option>
                              <option value="no_agent_assigned_for">No agent assigned for</option>
                              <option value="website_offline_first_message">Website offline: first message</option>
                              <option value="visitor_closed_chat">Visitor closed chat</option>
                              <option value="visitor_left_website">Visitor left website</option>
                              <option value="conversation_resolved">Conversation resolved</option>
                              <option value="conversation_reopened">Conversation reopened</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-2">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Where</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">Coming soon.</div>
                      </div>

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-2">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Audience</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">Coming soon.</div>
                      </div>

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-3">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Scheduling</div>
                        {builderDraft.trigger === 'no_agent_assigned_for' ? (
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Delay (seconds)</label>
                            <Input
                              type="number"
                              min={1}
                              value={String(builderDraft.delay_seconds ?? 60)}
                              onChange={(e) =>
                                setBuilderDraft({
                                  ...builderDraft,
                                  delay_seconds: Math.max(1, parseInt(e.target.value || '60', 10) || 60),
                                })
                              }
                            />
                          </div>
                        ) : builderDraft.trigger === 'visitor_connected' ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Delay (seconds)</label>
                              <Input
                                type="number"
                                min={0}
                                value={String(builderDraft.welcome_delay_seconds ?? 3)}
                                onChange={(e) =>
                                  setBuilderDraft({
                                    ...builderDraft,
                                    welcome_delay_seconds: Math.max(0, parseInt(e.target.value || '3', 10) || 0),
                                  })
                                }
                              />
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                How many seconds after the visitor connects before the welcome message appears. Set to 0 for instant.
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Cooldown (hours)</label>
                              <Input
                                type="number"
                                min={1}
                                value={String(builderDraft.cooldown_hours ?? 24)}
                                onChange={(e) =>
                                  setBuilderDraft({
                                    ...builderDraft,
                                    cooldown_hours: Math.max(1, parseInt(e.target.value || '24', 10) || 24),
                                  })
                                }
                              />
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                How long before the welcome message can be sent again to the same visitor.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Repeat</label>
                              <div className="flex items-center gap-2 flex-wrap">
                                {(['once', 'cooldown', 'always'] as const).map((mode) => {
                                  const active = (builderDraft.repeat || 'once') === mode
                                  const label = mode === 'once' ? 'Once' : mode === 'cooldown' ? 'Cooldown' : 'Always'
                                  return (
                                    <Button
                                      key={mode}
                                      type="button"
                                      size="sm"
                                      variant={active ? 'secondary' : 'outline'}
                                      onClick={() =>
                                        setBuilderDraft({
                                          ...builderDraft,
                                          repeat: mode,
                                          repeat_cooldown_seconds:
                                            mode === 'cooldown'
                                              ? Math.max(1, Number(builderDraft.repeat_cooldown_seconds ?? 3600) || 3600)
                                              : undefined,
                                        })
                                      }
                                    >
                                      {label}
                                    </Button>
                                  )
                                })}
                              </div>
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                Controls whether this automation can run again for the same conversation.
                              </div>
                            </div>

                            {(builderDraft.repeat || 'once') === 'cooldown' ? (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Cooldown (seconds)
                                </label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={String(builderDraft.repeat_cooldown_seconds ?? 3600)}
                                  onChange={(e) =>
                                    setBuilderDraft({
                                      ...builderDraft,
                                      repeat_cooldown_seconds: Math.max(1, parseInt(e.target.value || '3600', 10) || 3600),
                                    })
                                  }
                                />
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4 space-y-3">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Behavior</div>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Enabled</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Turn this automation on/off.</div>
                          </div>
                          <Switch
                            checked={builderDraft.enabled}
                            onCheckedChange={(checked) => setBuilderDraft({ ...builderDraft, enabled: checked })}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Action type</label>
                          <select
                            value={builderDraft.action_type}
                            onChange={(e) => {
                              const nextType = e.target.value === 'emit_system_event' ? 'emit_system_event' : 'send_bot_message'
                              setBuilderDraft({
                                ...builderDraft,
                                action_type: nextType,
                                event_type:
                                  nextType === 'emit_system_event'
                                    ? builderDraft.event_type || builderDraft.trigger
                                    : builderDraft.event_type,
                              })
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          >
                            <option value="send_bot_message">Bot message</option>
                            <option value="emit_system_event">System event</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {builderDraft.action_type === 'emit_system_event' ? 'Content' : 'Message'}
                          </label>
                          <Textarea
                            value={builderDraft.message}
                            onChange={(e) => setBuilderDraft({ ...builderDraft, message: e.target.value })}
                            placeholder="Enter bot message..."
                          />
                        </div>

                        <div>
                          {builderDraft.action_type === 'emit_system_event' ? (
                            <>
                              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Event type</label>
                              <Input
                                value={builderDraft.event_type || ''}
                                onChange={(e) => setBuilderDraft({ ...builderDraft, event_type: e.target.value || undefined })}
                                placeholder={builderDraft.trigger || 'conversation_resolved'}
                              />
                            </>
                          ) : builderDraft.trigger !== 'visitor_connected' && (
                            <>
                              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Event type (optional)</label>
                              <Input
                                value={builderDraft.event_type || ''}
                                onChange={(e) => setBuilderDraft({ ...builderDraft, event_type: e.target.value || undefined })}
                                placeholder="bot_waiting"
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={closeBuilder}>
                      Cancel
                    </Button>

                    {builderStep === 'edit_auto_message' && builderDraft?.id ? (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          if (!builderDraft?.id) return
                          const automation = automations.find((a) => a.id === builderDraft.id)
                          if (!automation) {
                            setAutomationsError('Automation not found')
                            return
                          }
                          deleteAutomation(automation)
                        }}
                        disabled={deletingAutomationId === builderDraft.id}
                        className="gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        {deletingAutomationId === builderDraft.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    ) : null}
                  </div>

                  {builderStep === 'edit_auto_message' ? (
                    <Button type="button" onClick={saveBuilderDraft} disabled={builderSaving} className="gap-2">
                      <Save className="w-4 h-4" />
                      {builderSaving ? 'Saving…' : 'Save automation'}
                    </Button>
                  ) : (
                    <Button type="button" onClick={closeBuilder}>Done</Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Basic Settings Tab */}
        {(isNew || activeTab === 'settings') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Basic Information
              </CardTitle>
              <CardDescription>Website identification and domain</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Website Name *
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Website"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  A friendly name to identify this website
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Domain *
                </label>
                <Input
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="example.com"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  The domain where the chat widget will be embedded
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Office Hours (Smartsupp-like) */}
        {(isNew || activeTab === 'settings') && (
          <Card>
            <CardHeader>
              <CardTitle>Office Hours</CardTitle>
              <CardDescription>
                When enabled, the widget is forced offline outside these hours.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Office Hours</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Agent online status is ignored outside hours</div>
                </div>
                <Switch
                  checked={!!(formData.widget_config as any).office_hours?.enabled}
                  onCheckedChange={(checked) => {
                    const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                    setFormData({
                      ...formData,
                      widget_config: {
                        ...formData.widget_config,
                        office_hours: { ...current, enabled: checked },
                      },
                    })
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timezone</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={String((formData.widget_config as any).office_hours?.timezone || '')}
                    onChange={(e) => {
                      const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                      setFormData({
                        ...formData,
                        widget_config: {
                          ...formData.widget_config,
                          office_hours: { ...current, timezone: e.target.value },
                        },
                      })
                    }}
                    placeholder="e.g. Europe/London"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                      setFormData({
                        ...formData,
                        widget_config: {
                          ...formData.widget_config,
                          office_hours: { ...current, timezone: getBrowserTimeZone() },
                        },
                      })
                    }}
                  >
                    Use browser
                  </Button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Uses IANA timezone names (must match your account timezone).
                </p>
              </div>

              <div className="space-y-3">
                {(
                  [
                    { key: 'mon', label: 'Monday' },
                    { key: 'tue', label: 'Tuesday' },
                    { key: 'wed', label: 'Wednesday' },
                    { key: 'thu', label: 'Thursday' },
                    { key: 'fri', label: 'Friday' },
                    { key: 'sat', label: 'Saturday' },
                    { key: 'sun', label: 'Sunday' },
                  ] as { key: DayKey; label: string }[]
                ).map((day) => {
                  const current = coerceOfficeHours((formData.widget_config as any).office_hours)
                  const intervals = current.schedule[day.key] || []
                  const dayEnabled = intervals.length > 0
                  const disabled = !current.enabled

                  return (
                    <div key={day.key} className="p-3 border border-gray-200 dark:border-gray-800 rounded-lg">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{day.label}</div>
                        <Switch
                          checked={dayEnabled}
                          disabled={disabled}
                          onCheckedChange={(checked) => {
                            const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                            const nextSchedule = { ...next.schedule }
                            nextSchedule[day.key] = checked ? [{ start: '08:00', end: '17:00' }] : []
                            setFormData({
                              ...formData,
                              widget_config: {
                                ...formData.widget_config,
                                office_hours: { ...next, schedule: nextSchedule },
                              },
                            })
                          }}
                        />
                      </div>

                      {dayEnabled ? (
                        <div className="mt-3 space-y-2">
                          {intervals.map((interval, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="time"
                                value={interval.start}
                                disabled={disabled}
                                onChange={(e) => {
                                  const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                  const nextSchedule = { ...next.schedule }
                                  const nextIntervals = [...(nextSchedule[day.key] || [])]
                                  nextIntervals[idx] = { ...nextIntervals[idx], start: e.target.value }
                                  nextSchedule[day.key] = nextIntervals
                                  setFormData({
                                    ...formData,
                                    widget_config: {
                                      ...formData.widget_config,
                                      office_hours: { ...next, schedule: nextSchedule },
                                    },
                                  })
                                }}
                                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              />
                              <span className="text-sm text-gray-500 dark:text-gray-400">to</span>
                              <input
                                type="time"
                                value={interval.end}
                                disabled={disabled}
                                onChange={(e) => {
                                  const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                  const nextSchedule = { ...next.schedule }
                                  const nextIntervals = [...(nextSchedule[day.key] || [])]
                                  nextIntervals[idx] = { ...nextIntervals[idx], end: e.target.value }
                                  nextSchedule[day.key] = nextIntervals
                                  setFormData({
                                    ...formData,
                                    widget_config: {
                                      ...formData.widget_config,
                                      office_hours: { ...next, schedule: nextSchedule },
                                    },
                                  })
                                }}
                                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={disabled}
                                onClick={() => {
                                  const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                                  const nextSchedule = { ...next.schedule }
                                  const nextIntervals = [...(nextSchedule[day.key] || [])]
                                  nextIntervals.splice(idx, 1)
                                  nextSchedule[day.key] = nextIntervals
                                  setFormData({
                                    ...formData,
                                    widget_config: {
                                      ...formData.widget_config,
                                      office_hours: { ...next, schedule: nextSchedule },
                                    },
                                  })
                                }}
                                className="px-2"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}

                          <Button
                            type="button"
                            variant="outline"
                            disabled={disabled}
                            onClick={() => {
                              const next = coerceOfficeHours((formData.widget_config as any).office_hours)
                              const nextSchedule = { ...next.schedule }
                              const nextIntervals = [...(nextSchedule[day.key] || [])]
                              nextIntervals.push({ start: '08:00', end: '17:00' })
                              nextSchedule[day.key] = nextIntervals
                              setFormData({
                                ...formData,
                                widget_config: {
                                  ...formData.widget_config,
                                  office_hours: { ...next, schedule: nextSchedule },
                                },
                              })
                            }}
                            className="gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Add interval
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Widget Configuration Tab */}
        {!isNew && activeTab === 'widget' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Widget Customization
              </CardTitle>
              <CardDescription>Customize the chat widget appearance and behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Header Icon (Optional)
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                    {formData.widget_config.header_icon_url ? (
                      <img
                        src={`${API_BASE}${formData.widget_config.header_icon_url}`}
                        alt="Widget icon"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">None</span>
                    )}
                  </div>

                  {isAdmin(user) && (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUploadWidgetIcon(file)
                        e.currentTarget.value = ''
                      }}
                      className="text-sm text-gray-700 dark:text-gray-300"
                      disabled={saving}
                    />
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Shown as the single header icon until an agent joins (then agent avatar replaces it).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Theme
                  </label>
                  <select
                    value={formData.widget_config.theme}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, theme: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Position
                  </label>
                  <select
                    value={formData.widget_config.position}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, position: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="top-left">Top Left</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Header Title
                </label>
                <Input
                  value={formData.widget_config.header_title}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, header_title: e.target.value }
                  })}
                  placeholder="How can we help?"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Text shown in the widget header
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Online Status Text
                </label>
                <Input
                  value={formData.widget_config.online_status_text}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, online_status_text: e.target.value }
                  })}
                  placeholder="We reply immediately"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Status message shown below header
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Welcome automation is managed in the Automations tab.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bubble Text
                </label>
                <Input
                  value={formData.widget_config.bubble_text}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, bubble_text: e.target.value }
                  })}
                  placeholder="Chat"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Text shown on the minimized chat bubble
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Main Color
                </label>

                {/* Color mode toggle */}
                <div className="flex items-center gap-1 mb-3 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, color_mode: 'gradient' }
                    })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${formData.widget_config.color_mode === 'gradient'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                  >
                    Gradient
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, color_mode: 'solid' }
                    })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${formData.widget_config.color_mode === 'solid'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                  >
                    Solid
                  </button>
                </div>

                {/* Preset color swatches */}
                {(() => {
                  const presets = formData.widget_config.color_mode === 'gradient'
                    ? [
                      { start: '#3b82f6', end: '#2563eb' },  // Blue
                      { start: '#ef4444', end: '#dc2626' },  // Red
                      { start: '#f97316', end: '#ea580c' },  // Orange
                      { start: '#22c55e', end: '#16a34a' },  // Green
                      { start: '#0ea5e9', end: '#0284c7' },  // Sky
                      { start: '#8b5cf6', end: '#7c3aed' },  // Purple
                      { start: '#ec4899', end: '#db2777' },  // Pink
                      { start: '#14b8a6', end: '#0d9488' },  // Teal
                      { start: '#6366f1', end: '#4f46e5' },  // Indigo
                      { start: '#111827', end: '#374151' },  // Dark
                    ]
                    : [
                      { color: '#3b82f6' },  // Blue
                      { color: '#ef4444' },  // Red
                      { color: '#f97316' },  // Orange
                      { color: '#22c55e' },  // Green
                      { color: '#0ea5e9' },  // Sky
                      { color: '#8b5cf6' },  // Purple
                      { color: '#ec4899' },  // Pink
                      { color: '#14b8a6' },  // Teal
                      { color: '#6366f1' },  // Indigo
                      { color: '#111827' },  // Dark
                    ];
                  return (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {formData.widget_config.color_mode === 'gradient'
                        ? (presets as { start: string; end: string }[]).map((p, i) => {
                          const isSelected = formData.widget_config.gradient_start === p.start && formData.widget_config.gradient_end === p.end;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setFormData({
                                ...formData,
                                widget_config: {
                                  ...formData.widget_config,
                                  gradient_start: p.start,
                                  gradient_end: p.end,
                                  primary_color: p.start,
                                }
                              })}
                              className={`w-8 h-8 rounded-full border-2 transition-all ${isSelected ? 'border-blue-500 scale-110 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-600 hover:scale-105'}`}
                              style={{ background: `linear-gradient(135deg, ${p.start} 0%, ${p.end} 100%)` }}
                              title={`${p.start} → ${p.end}`}
                            />
                          );
                        })
                        : (presets as { color: string }[]).map((p, i) => {
                          const isSelected = formData.widget_config.primary_color === p.color;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setFormData({
                                ...formData,
                                widget_config: {
                                  ...formData.widget_config,
                                  primary_color: p.color,
                                }
                              })}
                              className={`w-8 h-8 rounded-full border-2 transition-all ${isSelected ? 'border-blue-500 scale-110 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-600 hover:scale-105'}`}
                              style={{ background: p.color }}
                              title={p.color}
                            />
                          );
                        })
                      }
                    </div>
                  );
                })()}

                {/* Custom color inputs */}
                {formData.widget_config.color_mode === 'gradient' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Start Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={formData.widget_config.gradient_start}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, gradient_start: e.target.value, primary_color: e.target.value }
                          })}
                          className="w-9 h-9 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                        />
                        <Input
                          value={formData.widget_config.gradient_start}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, gradient_start: e.target.value, primary_color: e.target.value }
                          })}
                          placeholder="#3b82f6"
                          className="flex-1 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">End Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={formData.widget_config.gradient_end}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, gradient_end: e.target.value }
                          })}
                          className="w-9 h-9 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                        />
                        <Input
                          value={formData.widget_config.gradient_end}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, gradient_end: e.target.value }
                          })}
                          placeholder="#2563eb"
                          className="flex-1 text-xs"
                        />
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="h-8 rounded-lg w-full" style={{ background: `linear-gradient(135deg, ${formData.widget_config.gradient_start} 0%, ${formData.widget_config.gradient_end} 100%)` }} />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formData.widget_config.primary_color}
                      onChange={(e) => setFormData({
                        ...formData,
                        widget_config: { ...formData.widget_config, primary_color: e.target.value }
                      })}
                      className="w-9 h-9 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                    />
                    <Input
                      value={formData.widget_config.primary_color}
                      onChange={(e) => setFormData({
                        ...formData,
                        widget_config: { ...formData.widget_config, primary_color: e.target.value }
                      })}
                      placeholder="#3b82f6"
                      className="flex-1"
                    />
                  </div>
                )}

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Main color for header, buttons, message bubbles, and chat bubble
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Branding Text (Optional)
                </label>
                <Input
                  value={formData.widget_config.branding_text || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    widget_config: { ...formData.widget_config, branding_text: e.target.value || null }
                  })}
                  placeholder="Powered by Your Company"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Optional branding text shown at bottom of widget
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show_emoji_picker"
                    checked={formData.widget_config.show_emoji_picker}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, show_emoji_picker: e.target.checked }
                    })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="show_emoji_picker" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable Emoji Picker
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show_attachments"
                    checked={formData.widget_config.show_attachments}
                    onChange={(e) => setFormData({
                      ...formData,
                      widget_config: { ...formData.widget_config, show_attachments: e.target.checked }
                    })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="show_attachments" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable File Attachments (Coming Soon)
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

        )}

        {/* Danger Zone Tab */}
        {!isNew && activeTab === 'danger' && (
          <Card className="border-red-200 dark:border-red-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-5 h-5" />
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible actions for this website
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Delete this website</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    This will permanently remove the website, all its conversations, teams, tags, and automations.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={saving}
                  className="gap-1 shrink-0 ml-4"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Website
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Save / Cancel buttons (shown on tabs that have form data) */}
        {(isNew || activeTab === 'settings' || activeTab === 'widget') && (
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" size="sm" disabled={saving} className="gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : isNew ? 'Create Website' : 'Save Changes'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate('/dashboard/settings/websites')}
            >
              Cancel
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}
