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
  visitor_avatar_color?: string | null
  last_message?: string
  last_message_at?: string
  status: string
  is_handoff: boolean
  assigned_agent_id: number | null
  current_agent_id?: number | null  // Alias for assigned_agent_id
  message_count: number
  unread_count?: number
  created_at?: string
  closed_at?: string
  closed_by?: string | null
  visitor_ended?: boolean
}

export async function fetchActiveChats(): Promise<ActiveChat[]> {
  const token = useAppStore.getState().token

  const chats = await apiRequest<ActiveChat[]>("/chats/active", {
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

export async function closeConversation(chatId: number): Promise<{ success: boolean; message: string }> {
  const token = useAppStore.getState().token

  return apiRequest(`/chats/${chatId}/close`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function fetchClosedConversations(websiteId?: number, agentId?: number, limit: number = 50): Promise<ActiveChat[]> {
  const token = useAppStore.getState().token

  const params = new URLSearchParams()
  if (websiteId) params.append('website_id', websiteId.toString())
  if (agentId) params.append('agent_id', agentId.toString())
  if (limit) params.append('limit', limit.toString())

  const query = params.toString() ? `?${params.toString()}` : ''

  return apiRequest<ActiveChat[]>(`/chats/resolved/history${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
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
