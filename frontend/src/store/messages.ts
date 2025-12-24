import { create } from "zustand"
import type { Message } from "../types/index"

type MessageState = {
  messages: Message[]
  addMessages: (m: Message[]) => void
  addMessage: (m: Message) => void
  setMessages: (messages: Message[]) => void
  reset: () => void
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: [],

  addMessages: (incoming) => {
    const existing = get().messages
    const map = new Map(
      existing.map((m, idx) => [m.id || `temp-${idx}`, m])
    )

    incoming.forEach((m, idx) => {
      const key = m.id || `temp-${Date.now()}-${idx}`
      if (!map.has(key)) {
        map.set(key, m)
      }
    })

    set({ messages: Array.from(map.values()) })
  },

  addMessage: (m) =>
    set((state) => ({
      messages: [...state.messages, m],
    })),

  setMessages: (messages) => set({ messages }),

  reset: () => set({ messages: [] }),
}))
