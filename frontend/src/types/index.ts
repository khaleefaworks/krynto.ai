export type UserRole = "system_manager" | "manager" | "agent"

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  is_available: boolean
  is_active: boolean
  avatar_url?: string | null
}

export interface Conversation {
  id: number
  website_id: number
  session_id: string
  status: string
  is_handoff: boolean
  assigned_agent_id: number | null
  message_count: number
}

export interface Message {
  id?: number
  conversation_id?: number
  sender: "visitor" | "ai" | "agent"
  content: string
  created_at?: string
}
