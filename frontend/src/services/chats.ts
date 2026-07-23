import { apiRequest } from "./api"
import { useAppStore } from "../store/appStore"

export type ActiveChat = {
  id: number
  short_id: string
  website_id: number
  website_name?: string
  session_id: string
  visitor_name?: string | null
  visitor_email?: string | null
  visitor_phone?: string | null
  device_info?: string | null
  browser_info?: string | null
  visit_count?: number | null
  last_seen_at?: string | null
  is_online?: boolean
  visitor_avatar_color?: string | null
  last_message?: string
  last_message_at?: string
  status: string
  is_handoff: boolean
  assigned_agent_id: number | null
  assigned_agent?: { id: number; name: string | null; avatar_url: string | null } | null
  current_agent_id?: number | null  // Alias for assigned_agent_id
  message_count: number
  unread_count?: number
  created_at?: string
  closed_at?: string
  closed_by?: string | null
  visitor_ended?: boolean
  bot_only?: boolean
}

export async function fetchActiveChats(opts?: { botOnly?: boolean; excludeBotOnly?: boolean }): Promise<ActiveChat[]> {
  const token = useAppStore.getState().token

  const params = new URLSearchParams()
  if (opts?.botOnly) params.append('bot_only', 'true')
  if (opts?.excludeBotOnly) params.append('exclude_bot_only', 'true')
  const query = params.toString() ? `?${params.toString()}` : ''

  const chats = await apiRequest<ActiveChat[]>(`/chats/active${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  // Map assigned_agent_id to current_agent_id for compatibility
  return chats.map(chat => ({
    ...chat,
    current_agent_id: chat.assigned_agent_id
  }))
}

export async function joinChat(chatId: string) {
  const token = useAppStore.getState().token

  return apiRequest(`/chats/${chatId}/join`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function markChatRead(chatId: number): Promise<{ success: boolean; conversation_id: number }> {
  const token = useAppStore.getState().token

  return apiRequest(`/chats/${chatId}/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export type ChatReadState = {
  conversation_id: number
  last_read_at: string | null
  first_unread_message_id: number | null
}

export async function fetchChatReadState(chatId: number): Promise<ChatReadState> {
  const token = useAppStore.getState().token

  return apiRequest<ChatReadState>(`/chats/${chatId}/read-state`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function takeoverConversation(conversationId: number): Promise<{ success: boolean; conversation_id: number }> {
  const token = useAppStore.getState().token

  return apiRequest(`/conversations/${conversationId}/takeover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function sendContactCard(chatId: string | number, formId: number): Promise<{ success: boolean; message_id?: number; message_obj?: any }> {
  const token = useAppStore.getState().token

  return apiRequest(`/chats/${chatId}/send-contact-card`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ form_id: formId }),
  })
}

export async function closeConversation(chatId: number): Promise<{ success: boolean; message: string }> {
  const token = useAppStore.getState().token

  return apiRequest(`/chats/${chatId}/close`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export interface ClosedConversationFilters {
  websiteId?: number
  agentId?: number
  limit?: number
  offset?: number
  search?: string
  teamId?: number
  tagIds?: number[]
  dateFrom?: string
  dateTo?: string
}

export async function fetchClosedConversations(
  websiteId?: number,
  agentId?: number,
  limit: number = 50,
  offset: number = 0,
  filters?: Omit<ClosedConversationFilters, 'websiteId' | 'agentId' | 'limit' | 'offset'>
): Promise<ActiveChat[]> {
  const token = useAppStore.getState().token

  const params = new URLSearchParams()
  if (websiteId) params.append('website_id', websiteId.toString())
  if (agentId) params.append('agent_id', agentId.toString())
  if (limit) params.append('limit', limit.toString())
  if (offset) params.append('offset', offset.toString())
  if (filters?.search) params.append('search', filters.search)
  if (filters?.teamId) params.append('team_id', filters.teamId.toString())
  if (filters?.tagIds?.length) params.append('tag_ids', filters.tagIds.join(','))
  if (filters?.dateFrom) params.append('date_from', filters.dateFrom)
  if (filters?.dateTo) params.append('date_to', filters.dateTo)

  const query = params.toString() ? `?${params.toString()}` : ''

  return apiRequest<ActiveChat[]>(`/chats/resolved/history${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function fetchResolvedCount(
  filters?: Omit<ClosedConversationFilters, 'limit' | 'offset'>
): Promise<number> {
  const token = useAppStore.getState().token

  const params = new URLSearchParams()
  if (filters?.websiteId) params.append('website_id', filters.websiteId.toString())
  if (filters?.agentId) params.append('agent_id', filters.agentId.toString())
  if (filters?.search) params.append('search', filters.search)
  if (filters?.teamId) params.append('team_id', filters.teamId.toString())
  if (filters?.tagIds?.length) params.append('tag_ids', filters.tagIds.join(','))
  if (filters?.dateFrom) params.append('date_from', filters.dateFrom)
  if (filters?.dateTo) params.append('date_to', filters.dateTo)

  const query = params.toString() ? `?${params.toString()}` : ''

  const result = await apiRequest<{ total: number }>(`/chats/resolved/count${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return result.total
}

export async function updateFormSubmission(
  chatId: number,
  submissionId: number,
  data: Record<string, string>,
): Promise<{
  id: number
  form_id: number
  form_name: string | null
  is_contact_card: boolean
  data: Record<string, string>
  // Present (non-null) only for an is_contact_card submission — the
  // conversation's visitor_name/email/phone after this edit was synced
  // onto them server-side, so the caller can patch local conversation
  // state without a second round trip.
  conversation: { visitor_name: string | null; visitor_email: string | null; visitor_phone: string | null } | null
}> {
  return apiRequest(`/chats/${chatId}/form-submissions/${submissionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ data }),
  })
}

export async function fetchChatSummary(chatId: number): Promise<ActiveChat> {
  const token = useAppStore.getState().token

  const chat = await apiRequest<ActiveChat>(`/chats/${chatId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return {
    ...chat,
    current_agent_id: (chat as any).assigned_agent_id,
  }
}
