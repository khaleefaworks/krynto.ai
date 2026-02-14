import { create } from "zustand"
import type { Message } from "../types/index"

function messageKey(m: Message, fallback: string): string {
  const id = (m as any)?.id
  if (id === 0 || id) return String(id)
  return fallback
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const aIdRaw = (a as any).id
    const bIdRaw = (b as any).id
    const aId = typeof aIdRaw === 'number' ? aIdRaw : Number(aIdRaw)
    const bId = typeof bIdRaw === 'number' ? bIdRaw : Number(bIdRaw)
    const aHasId = Number.isFinite(aId)
    const bHasId = Number.isFinite(bId)
    if (aHasId && bHasId && aId !== bId) return aId - bId

    const at = a.created_at ? Date.parse(a.created_at) : NaN
    const bt = b.created_at ? Date.parse(b.created_at) : NaN
    const aTime = Number.isFinite(at) ? at : 0
    const bTime = Number.isFinite(bt) ? bt : 0
    if (aTime !== bTime) return aTime - bTime

    const aKey = aHasId ? aId : Number.MAX_SAFE_INTEGER
    const bKey = bHasId ? bId : Number.MAX_SAFE_INTEGER
    return aKey - bKey
  })
}

type MessageState = {
  messages: Message[]
  addMessages: (m: Message[]) => void
  addMessage: (m: Message) => void
  reconcileOptimisticMessage: (tempId: string, confirmed: Message) => void
  setMessages: (messages: Message[]) => void
  reset: () => void
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: [],

  addMessages: (incoming) => {
    const existing = get().messages
    const map = new Map(existing.map((m, idx) => [messageKey(m, `temp-${idx}`), m]))

    incoming.forEach((m, idx) => {
      const key = messageKey(m, `temp-${Date.now()}-${idx}`)
      // Prefer the latest version of the same message id.
      map.set(key, m)
    })

    set({ messages: sortMessages(Array.from(map.values())) })
  },

  addMessage: (m) =>
    set((state) => {
      const key = messageKey(m, `temp-${Date.now()}`)
      const existing = state.messages
      const idx = existing.findIndex((x, i) => messageKey(x, `temp-${i}`) === key)
      if (idx >= 0) {
        const next = [...existing]
        next[idx] = m
        return { messages: sortMessages(next) }
      }
      return { messages: sortMessages([...existing, m]) }
    }),

  reconcileOptimisticMessage: (tempId, confirmed) =>
    set((state) => {
      const confirmedId = (confirmed as any)?.id
      if (confirmedId === 0 || confirmedId) {
        const exists = state.messages.some((m: any) => String((m as any)?.id) === String(confirmedId))
        if (exists) {
          // Thread already has the canonical message (e.g. after refresh).
          // Remove any temp placeholder if present.
          const withoutTemp = state.messages.filter((m: any) => String((m as any)?.id) !== String(tempId))
          return { messages: sortMessages(withoutTemp) }
        }
      }

      const idx = state.messages.findIndex((m: any) => String((m as any)?.id) === String(tempId))
      if (idx >= 0) {
        const next = [...state.messages]
        next[idx] = confirmed
        return { messages: sortMessages(next) }
      }
      return { messages: sortMessages([...state.messages, confirmed]) }
    }),

  setMessages: (messages) => set({ messages: sortMessages(messages) }),

  reset: () => set({ messages: [] }),
}))
