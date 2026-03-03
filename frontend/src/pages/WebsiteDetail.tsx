import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store/appStore'
import { isAdmin } from '@/lib/roles'
import { Save, Trash2, Globe, Copy, Check, Plus, X, Code, ExternalLink } from 'lucide-react'
import { API_BASE } from '@/config/endpoints'
import { automationsApi, type Automation, type AutomationAction } from '@/services/automations'
import WebsiteShortcutsTab from './WebsiteShortcutsTab'
import WebsiteTagsTab from './WebsiteTagsTab'
import WebsiteTeamsTab from './WebsiteTeamsTab'

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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-16 flex items-center gap-3 border-b dark:border-gray-700 px-6 flex-shrink-0">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
          <Globe className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
            {formData.name || 'Website'}
          </h1>
          {formData.domain && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{formData.domain}</p>
          )}
        </div>
      </div>

      {/* Full-height tabs with slide-over panels (rendered outside scroll wrapper) */}
      {!isNew && activeTab === 'shortcuts' && isAdmin(user) && websiteId && (
        <WebsiteShortcutsTab websiteId={websiteId} />
      )}
      {!isNew && activeTab === 'tags' && isAdmin(user) && websiteId && (
        <WebsiteTagsTab websiteId={websiteId} />
      )}
      {!isNew && activeTab === 'teams' && isAdmin(user) && websiteId && (
        <WebsiteTeamsTab websiteId={websiteId} />
      )}

      {/* Scrollable content (hidden when full-height tabs are active) */}
      {activeTab !== 'shortcuts' && activeTab !== 'tags' && activeTab !== 'teams' && (
        <div className="flex-1 overflow-auto">
          <div className="px-6 py-6 space-y-6">
            {error && (
              <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="p-3 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                {successMessage}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
              {/* Installation Tab */}
              {!isNew && activeTab === 'installation' && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">Installation</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Add the chat widget to your website in minutes.</p>
                  </div>

                  {/* Quick-start steps */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {[
                      { step: '1', label: 'Copy snippet', desc: 'Copy the embed code below' },
                      { step: '2', label: 'Paste in HTML', desc: 'Before closing </body> tag' },
                      { step: '3', label: 'Assign agents', desc: 'In the Teams tab' },
                      { step: '4', label: 'Go live', desc: 'Widget appears automatically' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-start gap-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-3 py-2.5">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[10px] font-bold text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">{s.step}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{s.label}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Credentials row */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-3.5 py-2.5">
                      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Website ID</p>
                      <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-100">{websiteId ?? '—'}</p>
                    </div>
                    <div className="sm:col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-3.5 py-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Widget Key</p>
                        <button
                          type="button"
                          onClick={copyWidgetKey}
                          disabled={!widgetKey}
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-40 inline-flex items-center gap-1"
                        >
                          {widgetKeyCopied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                        </button>
                      </div>
                      <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-100 break-all leading-snug">{widgetKey || '—'}</p>
                    </div>
                  </div>

                  {/* Embed snippet */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2">
                        <Code className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Embed Snippet</span>
                      </div>
                      <Button type="button" onClick={copySnippet} variant="outline" size="sm" className="h-6 gap-1.5 text-[11px] px-2">
                        {snippetCopied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                      </Button>
                    </div>
                    <div className="bg-gray-900 dark:bg-gray-950 p-4 overflow-x-auto">
                      <pre className="text-[13px] leading-relaxed text-gray-300 font-mono whitespace-pre-wrap">
                        {widgetSnippet || 'Loading...'}
                      </pre>
                    </div>
                  </div>

                  {/* Domain hint */}
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span>Widget will only load on <span className="font-medium text-gray-700 dark:text-gray-300">{formData.domain || 'your configured domain'}</span>. Change it in the General tab.</span>
                  </div>
                </div>
              )}

              {/* Automations Tab */}
              {!isNew && activeTab === 'automations' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Automations</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Configure per-website auto messages and triggers.</p>
                    </div>
                    <Button type="button" size="sm" onClick={openBuilderPickType} className="gap-2">
                      <Plus className="w-4 h-4" />
                      Build from scratch
                    </Button>
                  </div>

                  {/* Sub-tab pills */}
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
                    {(['templates', 'auto_messages', 'chatbots'] as const).map((tab) => {
                      const labels = { templates: 'Templates', auto_messages: 'Auto Messages', chatbots: 'Chatbots' }
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setAutomationsSubTab(tab)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${automationsSubTab === tab
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                          {labels[tab]}
                        </button>
                      )
                    })}
                  </div>

                  {automationsError && (
                    <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
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
                </div>
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
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">General</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Website identification and domain settings.</p>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Website Name *</label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="My Website"
                        required
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A friendly name to identify this website</p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Domain *</label>
                      <Input
                        value={formData.domain}
                        onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                        placeholder="example.com"
                        required
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The domain where the chat widget will be embedded</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Office Hours */}
              {(isNew || activeTab === 'settings') && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Office Hours</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">When enabled, the widget is forced offline outside these hours.</p>
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

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Timezone</label>
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
                          className="dark:bg-gray-800 dark:border-gray-700"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
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
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Uses IANA timezone names (must match your account timezone).</p>
                    </div>

                    <div className="space-y-2">
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
                          <div key={day.key} className="flex items-start gap-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                            <div className="w-24 shrink-0 pt-1">
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{day.label}</span>
                            </div>
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
                            <div className="flex-1">
                              {dayEnabled ? (
                                <div className="space-y-2">
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
                                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                      />
                                      <span className="text-xs text-gray-400">–</span>
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
                                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                      />
                                      <button
                                        type="button"
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
                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
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
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Add interval
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400 pt-1 inline-block">Closed</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Widget Configuration Tab */}
              {!isNew && activeTab === 'widget' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">Widget Customization</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Customize the chat widget appearance and behavior.</p>
                  </div>

                  {/* Icon & Layout */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Icon &amp; Layout</p>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Header Icon</label>
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center shrink-0">
                          {formData.widget_config.header_icon_url ? (
                            <img
                              src={`${API_BASE}${formData.widget_config.header_icon_url}`}
                              alt="Widget icon"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-gray-400">None</span>
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
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Shown as the header icon until an agent joins.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Theme</label>
                        <select
                          value={formData.widget_config.theme}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, theme: e.target.value }
                          })}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        >
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Position</label>
                        <select
                          value={formData.widget_config.position}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, position: e.target.value }
                          })}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        >
                          <option value="bottom-right">Bottom Right</option>
                          <option value="bottom-left">Bottom Left</option>
                          <option value="top-right">Top Right</option>
                          <option value="top-left">Top Left</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Text & Messaging */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Text &amp; Messaging</p>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Header Title</label>
                      <Input
                        value={formData.widget_config.header_title}
                        onChange={(e) => setFormData({
                          ...formData,
                          widget_config: { ...formData.widget_config, header_title: e.target.value }
                        })}
                        placeholder="How can we help?"
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Text shown in the widget header</p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Online Status Text</label>
                      <Input
                        value={formData.widget_config.online_status_text}
                        onChange={(e) => setFormData({
                          ...formData,
                          widget_config: { ...formData.widget_config, online_status_text: e.target.value }
                        })}
                        placeholder="We reply immediately"
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Status message shown below header</p>
                    </div>

                    <p className="text-xs text-gray-400">Welcome automation is managed in the Automations tab.</p>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Bubble Text</label>
                      <Input
                        value={formData.widget_config.bubble_text}
                        onChange={(e) => setFormData({
                          ...formData,
                          widget_config: { ...formData.widget_config, bubble_text: e.target.value }
                        })}
                        placeholder="Chat"
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Text shown on the minimized chat bubble</p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Branding Text</label>
                      <Input
                        value={formData.widget_config.branding_text || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          widget_config: { ...formData.widget_config, branding_text: e.target.value || null }
                        })}
                        placeholder="Powered by Your Company"
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Optional branding text shown at bottom of widget</p>
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Main Color</p>
                      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, color_mode: 'gradient' }
                          })}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${formData.widget_config.color_mode === 'gradient'
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
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${formData.widget_config.color_mode === 'solid'
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                          Solid
                        </button>
                      </div>
                    </div>

                    {/* Preset swatches */}
                    {(() => {
                      const presets = formData.widget_config.color_mode === 'gradient'
                        ? [
                          { start: '#3b82f6', end: '#2563eb' },
                          { start: '#ef4444', end: '#dc2626' },
                          { start: '#f97316', end: '#ea580c' },
                          { start: '#22c55e', end: '#16a34a' },
                          { start: '#0ea5e9', end: '#0284c7' },
                          { start: '#8b5cf6', end: '#7c3aed' },
                          { start: '#ec4899', end: '#db2777' },
                          { start: '#14b8a6', end: '#0d9488' },
                          { start: '#6366f1', end: '#4f46e5' },
                          { start: '#111827', end: '#374151' },
                        ]
                        : [
                          { color: '#3b82f6' },
                          { color: '#ef4444' },
                          { color: '#f97316' },
                          { color: '#22c55e' },
                          { color: '#0ea5e9' },
                          { color: '#8b5cf6' },
                          { color: '#ec4899' },
                          { color: '#14b8a6' },
                          { color: '#6366f1' },
                          { color: '#111827' },
                        ];
                      return (
                        <div className="flex flex-wrap gap-2">
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
                                  className={`w-7 h-7 rounded-full border-2 transition-all ${isSelected ? 'border-blue-500 scale-110 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-600 hover:scale-105'}`}
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
                                  className={`w-7 h-7 rounded-full border-2 transition-all ${isSelected ? 'border-blue-500 scale-110 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-600 hover:scale-105'}`}
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
                      <div className="space-y-3">
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
                                className="w-8 h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                              />
                              <Input
                                value={formData.widget_config.gradient_start}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  widget_config: { ...formData.widget_config, gradient_start: e.target.value, primary_color: e.target.value }
                                })}
                                placeholder="#3b82f6"
                                className="flex-1 text-xs dark:bg-gray-800 dark:border-gray-700"
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
                                className="w-8 h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                              />
                              <Input
                                value={formData.widget_config.gradient_end}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  widget_config: { ...formData.widget_config, gradient_end: e.target.value }
                                })}
                                placeholder="#2563eb"
                                className="flex-1 text-xs dark:bg-gray-800 dark:border-gray-700"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="h-6 rounded-lg w-full" style={{ background: `linear-gradient(135deg, ${formData.widget_config.gradient_start} 0%, ${formData.widget_config.gradient_end} 100%)` }} />
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
                          className="w-8 h-8 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                        />
                        <Input
                          value={formData.widget_config.primary_color}
                          onChange={(e) => setFormData({
                            ...formData,
                            widget_config: { ...formData.widget_config, primary_color: e.target.value }
                          })}
                          placeholder="#3b82f6"
                          className="flex-1 dark:bg-gray-800 dark:border-gray-700"
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">Main color for header, buttons, message bubbles, and chat bubble</p>
                  </div>

                  {/* Features */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 space-y-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Features</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 dark:text-gray-300">Emoji Picker</span>
                      <Switch
                        checked={formData.widget_config.show_emoji_picker}
                        onCheckedChange={(checked) => setFormData({
                          ...formData,
                          widget_config: { ...formData.widget_config, show_emoji_picker: checked }
                        })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm text-gray-700 dark:text-gray-300">File Attachments</span>
                        <p className="text-xs text-gray-400">Coming Soon</p>
                      </div>
                      <Switch
                        checked={formData.widget_config.show_attachments}
                        onCheckedChange={(checked) => setFormData({
                          ...formData,
                          widget_config: { ...formData.widget_config, show_attachments: checked }
                        })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Danger Zone Tab */}
              {!isNew && activeTab === 'danger' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-base font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Irreversible actions for this website.</p>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Delete this website</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Permanently removes the website, conversations, teams, tags, and automations.
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
                      Delete
                    </Button>
                  </div>
                </div>
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
        </div>
      )}
    </div>
  )
}
