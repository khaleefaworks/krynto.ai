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
  status: string
  is_handoff: boolean
  assigned_agent_id: number | null
  current_agent_id?: number | null
  message_count: number
  last_message?: string
  last_message_at?: string
  created_at?: string
  closed_at?: string
}

export interface Message {
  id?: number | string
  conversation_id?: number
  // Backwards-compatible sender label used in older UI paths.
  sender?: "visitor" | "ai" | "agent" | string
  // Canonical sender type from backend.
  sender_type?: "visitor" | "agent" | "system"
  // Actor taxonomy (new)
  actor?: "visitor" | "agent" | "bot" | "ai" | "system"
  // Kind taxonomy (new)
  kind?: "chat" | "event"
  // Subtype for system messages (e.g. automation_welcome, agent_join)
  event_type?: string | null
  sender_name?: string | null
  sender_avatar_url?: string | null
  content: string
  created_at?: string
}
