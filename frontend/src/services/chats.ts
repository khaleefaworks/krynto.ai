import { apiRequest } from "./api"
import { useAppStore } from "../store/appStore"

export type ActiveChat = {
  id: number
  website_id: number
  website_name?: string
  session_id: string
  last_message?: string
  status: string
  is_handoff: boolean
  assigned_agent_id: number | null
  message_count: number
  created_at?: string
  closed_at?: string
}

export async function fetchActiveChats(): Promise<ActiveChat[]> {
  const token = useAppStore.getState().token

  return apiRequest<ActiveChat[]>("/chats/active", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function joinChat(chatId: string) {
  const token = useAppStore.getState().token
  const agent = useAppStore.getState().agent

  if (!agent) {
    throw new Error("Agent not authenticated")
  }

  return apiRequest(`/chats/${chatId}/join`, {
    method: "POST",
    body: JSON.stringify({ agent_id: agent.id }),
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

  return apiRequest<ActiveChat[]>(`/chats/closed/history${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}
