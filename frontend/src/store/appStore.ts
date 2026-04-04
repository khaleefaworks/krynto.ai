import { create } from 'zustand'
import type { User, Conversation, Message, Organization } from '../types/index'

// Re-export types for convenience
export type { User, Conversation, Message, Organization }

interface AppState {
  // Auth
  user: User | null
  token: string | null
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void

  // Organization (populated for non-super-admin users)
  organization: Organization | null
  setOrganization: (org: Organization | null) => void

  // Chats
  activeChats: Conversation[]
  setActiveChats: (chats: Conversation[]) => void
  unreadChatsCount: number
  setUnreadChatsCount: (count: number) => void

  // Unread per conversation (agent inbox)
  unreadByConversationId: Record<number, number>
  incrementUnreadForConversation: (conversationId: number, delta?: number) => void
  setUnreadForConversation: (conversationId: number, count: number) => void
  setUnreadMapFromServer: (unreadByConversationId: Record<number, number>) => void
  clearUnreadForConversation: (conversationId: number) => void
  pruneUnreadByConversationIds: (validConversationIds: number[]) => void

  // Global chat notifications (event signal)
  chatEventsVersion: number
  lastChatEvent: { type: string; conversation_id?: number; website_id?: number } | null
  bumpChatEventsVersion: (event: { type: string; conversation_id?: number; website_id?: number }) => void

  // In-app notifications (toast surface)
  notifications: Array<{
    id: string
    createdAt: number
    title: string
    body?: string
    conversationId?: number
    websiteId?: number
    type: string
  }>
  pushNotification: (n: {
    title: string
    body?: string
    conversationId?: number
    websiteId?: number
    type: string
  }) => string
  dismissNotification: (id: string) => void

  // Prevent re-processing stale lastChatEvent on remount
  lastProcessedChatEventsVersion: number
  setLastProcessedChatEventsVersion: (version: number) => void

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

  // Organization
  organization: null,
  setOrganization: (org) => set({ organization: org }),

  // Chats
  activeChats: [],
  setActiveChats: (chats) => set({ activeChats: chats }),
  unreadChatsCount: 0,
  setUnreadChatsCount: (count) => set({ unreadChatsCount: count }),

  // Unread per conversation
  unreadByConversationId: {},
  incrementUnreadForConversation: (conversationId, delta = 1) =>
    set((state) => {
      const id = Number(conversationId)
      if (!Number.isFinite(id) || id <= 0) return state
      const next = { ...state.unreadByConversationId }
      next[id] = (next[id] || 0) + delta
      return { unreadByConversationId: next }
    }),
  setUnreadForConversation: (conversationId, count) =>
    set((state) => {
      const id = Number(conversationId)
      if (!Number.isFinite(id) || id <= 0) return state
      const safeCount = Math.max(0, Number(count) || 0)
      const prev = state.unreadByConversationId[id] || 0
      if (prev === safeCount) return state
      return { unreadByConversationId: { ...state.unreadByConversationId, [id]: safeCount } }
    }),
  setUnreadMapFromServer: (unreadByConversationId) =>
    set(() => ({ unreadByConversationId: { ...(unreadByConversationId || {}) } })),
  clearUnreadForConversation: (conversationId) =>
    set((state) => {
      const id = Number(conversationId)
      if (!Number.isFinite(id) || id <= 0) return state
      if (!state.unreadByConversationId[id]) return state
      return { unreadByConversationId: { ...state.unreadByConversationId, [id]: 0 } }
    }),
  pruneUnreadByConversationIds: (validConversationIds) =>
    set((state) => {
      const valid = new Set((validConversationIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)))
      const prev = state.unreadByConversationId
      let changed = false
      const next: Record<number, number> = {}
      for (const [key, value] of Object.entries(prev)) {
        const id = Number(key)
        if (valid.has(id)) {
          next[id] = value
        } else {
          changed = true
        }
      }
      return changed ? { unreadByConversationId: next } : state
    }),

  // Global chat notifications
  chatEventsVersion: 0,
  lastChatEvent: null,
  bumpChatEventsVersion: (event) =>
    set((state) => ({
      chatEventsVersion: state.chatEventsVersion + 1,
      lastChatEvent: event,
    })),

  // In-app notifications
  notifications: [],
  pushNotification: (n) => {
    const id = `n_${Date.now()}_${Math.random().toString(16).slice(2)}`
    set((state) => ({
      notifications: [
        {
          id,
          createdAt: Date.now(),
          title: String(n.title || '').trim() || 'Notification',
          body: n.body ? String(n.body) : undefined,
          conversationId:
            typeof n.conversationId === 'number' && Number.isFinite(n.conversationId) ? n.conversationId : undefined,
          websiteId:
            typeof n.websiteId === 'number' && Number.isFinite(n.websiteId) ? n.websiteId : undefined,
          type: String(n.type || 'event'),
        },
        ...state.notifications,
      ].slice(0, 5),
    }))
    return id
  },
  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),

  lastProcessedChatEventsVersion: 0,
  setLastProcessedChatEventsVersion: (version) => set({ lastProcessedChatEventsVersion: version }),

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
