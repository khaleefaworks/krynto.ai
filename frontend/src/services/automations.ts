import { apiRequest } from '@/services/api'

export type AutomationTrigger =
  | 'visitor_connected'
  | 'visitor_socket_connected'
  | 'no_agent_assigned_for'
  | 'website_offline_first_message'
  | 'visitor_closed_chat'
  | 'visitor_left_website'
  | 'conversation_resolved'
  | 'conversation_reopened'
  | 'conversation_created'

export type AutomationCategory = 'auto_message' | 'chatbot_flow' | 'ai_agent'

export interface BotPromptButton {
  label: string
  team_id?: number | null
  reply?: string
}

export interface AutomationAction {
  type: 'send_bot_message' | 'emit_system_event' | 'bot_prompt_buttons'
  message?: string
  content?: string
  event_type?: string
  allow_input?: boolean
  buttons?: BotPromptButton[]
}

export interface Automation {
  id: number
  website_id: number
  name: string
  trigger: AutomationTrigger | string
  enabled: boolean
  category: AutomationCategory | string
  conditions: Record<string, any>
  actions: AutomationAction[] | Record<string, any> | null
  created_at: string
  updated_at?: string | null
}

export interface AutomationCreatePayload {
  website_id: number
  name: string
  trigger: AutomationTrigger | string
  enabled?: boolean
  category?: AutomationCategory | string
  conditions?: Record<string, any>
  actions?: any
}

export interface AutomationUpdatePayload {
  name?: string
  trigger?: AutomationTrigger | string
  enabled?: boolean
  category?: AutomationCategory | string
  conditions?: Record<string, any>
  actions?: any
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
}
