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
  // Backwards-compatible sender label used in older UI paths.
  sender?: "visitor" | "ai" | "agent" | string
  // Canonical sender type from backend.
  sender_type?: "visitor" | "agent" | "system"
  // Subtype for system messages (e.g. automation_welcome, agent_join)
  event_type?: string | null
  content: string
  created_at?: string
}
