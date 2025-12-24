import { create } from 'zustand'

export interface Agent {
  id: number
  email: string
  is_active: boolean
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
  id: number
  conversation_id: number
  sender: 'visitor' | 'ai' | 'agent'
  content: string
  created_at: string
}

interface AppState {
  // Auth
  agent: Agent | null
  token: string | null
  setAgent: (agent: Agent | null) => void
  setToken: (token: string | null) => void
  
  // Chats
  activeChats: Conversation[]
  setActiveChats: (chats: Conversation[]) => void
  
  // Current Chat
  currentChat: Conversation | null
  messages: Message[]
  setCurrentChat: (chat: Conversation | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  
  // WebSocket
  ws: WebSocket | null
  setWebSocket: (ws: WebSocket | null) => void
  isConnected: boolean
  setConnected: (connected: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  // Auth
  agent: null,
  token: null,
  setAgent: (agent) => set({ agent }),
  setToken: (token) => set({ token }),
  
  // Chats
  activeChats: [],
  setActiveChats: (chats) => set({ activeChats: chats }),
  
  // Current Chat
  currentChat: null,
  messages: [],
  setCurrentChat: (chat) => set({ currentChat: chat }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),
  
  // WebSocket
  ws: null,
  setWebSocket: (ws) => set({ ws }),
  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),
}))
