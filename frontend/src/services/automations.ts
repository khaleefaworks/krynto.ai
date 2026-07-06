import { apiRequest } from '@/services/api'

export type AutomationTrigger =
  | 'visitor_connected'
  | 'visitor_new'
  | 'visitor_returning'
  | 'visitor_socket_connected'
  | 'visitor_dropped'
  | 'visitor_reconnected'
  | 'no_agent_assigned_for'
  | 'new_chat_unclaimed'
  | 'website_offline_first_message'
  | 'agent_joined'
  | 'conversation_created'
  | 'conversation_visitor_ended'
  | 'conversation_resolved'
  | 'conversation_auto_resolved'
  | 'conversation_reopened'

export type AutomationNodeType =
  | 'trigger'
  | 'send_bot_message'
  | 'emit_system_event'
  | 'wait'
  | 'condition'
  | 'bot_prompt_buttons'
  | 'show_rating_popup'
  | 'tag_conversation'
  | 'tag_with_agent_name'
  | 'repeat_new_chat_notification'
  | 'end'

export type AutomationCategory = 'auto_message' | 'chatbot_flow' | 'ai_agent'

export interface NodePosition {
  x: number
  y: number
}

export interface BotPromptSubPrompt {
  message: string
  allow_input?: boolean
  /** When true, suppress the "agent will be with you" waiting message after a leaf click. */
  suppress_waiting_message?: boolean
  /** When false, leaf sub-buttons never show the offline contact form (e.g. informational/Jobs path). Default true. */
  collect_contact?: boolean
  buttons: BotPromptButton[]
}

export interface BotPromptButton {
  label: string
  team_id?: number | null
  reply?: string
  /** If set, clicking this button shows a nested sub-prompt instead of completing the flow. */
  sub_prompt?: BotPromptSubPrompt | null
}

export interface AutomationNode {
  id: string
  type: AutomationNodeType
  config: Record<string, any>
  position: NodePosition
}

export interface AutomationEdge {
  id: string
  from: string
  to: string
  branch?: 'true' | 'false' | null
}

export interface Automation {
  id: number
  website_id: number
  name: string
  trigger: AutomationTrigger | string
  enabled: boolean
  category: AutomationCategory | string
  nodes: AutomationNode[] | null
  edges: AutomationEdge[] | null
  template_id?: number | null
  created_at: string
  updated_at?: string | null
}

export interface AutomationTemplate {
  id: number
  name: string
  description: string | null
  trigger: AutomationTrigger | string
  category: AutomationCategory | string
  nodes: AutomationNode[] | null
  edges: AutomationEdge[] | null
  created_at: string
}

export interface AutomationCreatePayload {
  website_id: number
  name: string
  trigger: AutomationTrigger | string
  enabled?: boolean
  category?: AutomationCategory | string
  nodes?: AutomationNode[]
  edges?: AutomationEdge[]
}

export interface AutomationUpdatePayload {
  name?: string
  trigger?: AutomationTrigger | string
  enabled?: boolean
  category?: AutomationCategory | string
  nodes?: AutomationNode[]
  edges?: AutomationEdge[]
}

export const automationsApi = {
  list: (websiteId: number) =>
    apiRequest<Automation[]>(`/automations?website_id=${websiteId}`),
  create: (payload: AutomationCreatePayload) =>
    apiRequest<Automation>(`/automations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (id: number, payload: AutomationUpdatePayload) =>
    apiRequest<Automation>(`/automations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  remove: (id: number) =>
    apiRequest<void>(`/automations/${id}`, {
      method: 'DELETE',
    }),
  resetToDefault: (id: number) =>
    apiRequest<Automation>(`/automations/${id}/reset-to-default`, {
      method: 'POST',
    }),
}

export const automationTemplatesApi = {
  list: () =>
    apiRequest<AutomationTemplate[]>(`/automation-templates`),
  use: (templateId: number, websiteId: number, name?: string) =>
    apiRequest<Automation>(`/automation-templates/${templateId}/use`, {
      method: 'POST',
      body: JSON.stringify({ website_id: websiteId, name }),
    }),
}
