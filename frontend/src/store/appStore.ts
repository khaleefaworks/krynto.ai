import { create } from 'zustand'
import type { User, Conversation, Message } from '../types/index'

// Re-export types for convenience
export type { User, Conversation, Message }

interface AppState {
  // Auth
  user: User | null
  token: string | null
  setUser: (user: User | null) => void
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
  user: null,
  token: null,
  setUser: (user) => set({ user }),
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
