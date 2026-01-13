import { apiRequest } from "./api"
import { useAppStore } from "../store/appStore"
import type { Message } from "../types/index"

export async function fetchChatMessages(
  conversationId: string
): Promise<Message[]> {
  const token = useAppStore.getState().token

  return apiRequest<Message[]>(`/chats/${conversationId}/messages`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}
