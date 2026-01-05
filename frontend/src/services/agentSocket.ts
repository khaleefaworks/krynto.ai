import { useAppStore } from "../store/appStore"

let socket: WebSocket | null = null
let reconnectTimeout: NodeJS.Timeout | null = null
let currentWebsiteId: number | null = null
let currentAgentId: number | null = null
let isIntentionalClose = false
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY = 1000 // 1 second

// Message handler registry - allows multiple listeners
type MessageHandler = (data: any) => void
const messageHandlers = new Set<MessageHandler>()

// Message queue for offline messages
interface QueuedMessage {
  id: string
  conversationId: string
  content: string
  timestamp: number
  retries: number
}
const messageQueue: QueuedMessage[] = []
const MAX_RETRIES = 3
const RETRY_DELAY = 2000

// Pending acknowledgments
const pendingAcks = new Map<string, NodeJS.Timeout>()

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function connectAgentSocket(websiteId: number, agentId: number) {
  // Return existing socket if already connected
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("♻️ Reusing existing WebSocket connection")
    return socket
  }

  // Close any existing socket in bad state
  if (socket) {
    isIntentionalClose = true
    socket.close()
    socket = null
  }

  const token = useAppStore.getState().token

  if (!token) {
    throw new Error("Not authenticated")
  }

  // Store connection params for reconnection
  currentWebsiteId = websiteId
  currentAgentId = agentId
  isIntentionalClose = false

  // Include JWT token in query parameter for authentication
  const wsUrl = `ws://localhost:8000/ws/agent/${websiteId}?token=${encodeURIComponent(token)}`
  console.log("🔌 Connecting to WebSocket (authenticated):", `ws://localhost:8000/ws/agent/${websiteId}`)
  socket = new WebSocket(wsUrl)

  socket.onopen = () => {
    console.log("✅ WebSocket connected")
    reconnectAttempts = 0 // Reset on successful connection
    
    // Clear any pending reconnect
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    
    // Flush queued messages
    flushMessageQueue()
  }

  // Single message handler that dispatches to all registered handlers
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data)
    console.log("📨 WebSocket message received:", data)
    
    // Handle acknowledgments
    if (data.type === "ack" && data.message_id) {
      handleAck(data.message_id)
    }
    
    // Dispatch to all registered handlers
    messageHandlers.forEach(handler => {
      try {
        handler(data)
      } catch (error) {
        console.error("❌ Error in message handler:", error)
      }
    })
  }

  socket.onclose = (event) => {
    console.log("🔌 WebSocket closed", event.code, event.reason)
    socket = null
    
    // Only auto-reconnect if not intentional and connection params exist
    if (!isIntentionalClose && event.code !== 1000 && currentWebsiteId && currentAgentId) {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error("❌ Max reconnection attempts reached. Giving up.")
        // TODO: Show user notification that connection failed
        return
      }
      
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s...
      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 32000)
      reconnectAttempts++
      
      console.log(`🔄 Will attempt reconnect #${reconnectAttempts} in ${delay}ms...`)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      reconnectTimeout = setTimeout(() => {
        console.log(`🔄 Reconnecting (attempt ${reconnectAttempts})...`)
        connectAgentSocket(currentWebsiteId!, currentAgentId!)
      }, delay)
    }
  }

  socket.onerror = (error) => {
    console.error("❌ WebSocket error:", error)
  }

  return socket
}

function handleAck(messageId: string) {
  console.log("✅ Message acknowledged:", messageId)
  
  // Clear pending timeout
  const timeout = pendingAcks.get(messageId)
  if (timeout) {
    clearTimeout(timeout)
    pendingAcks.delete(messageId)
  }
  
  // Remove from queue if present
  const queueIndex = messageQueue.findIndex(m => m.id === messageId)
  if (queueIndex >= 0) {
    messageQueue.splice(queueIndex, 1)
    console.log(`🗑️ Removed from queue (remaining: ${messageQueue.length})`)
  }
}

function flushMessageQueue() {
  if (messageQueue.length === 0) return
  
  console.log(`📤 Flushing message queue (${messageQueue.length} messages)`)
  
  const messages = [...messageQueue]
  messageQueue.length = 0
  
  messages.forEach(msg => {
    if (msg.retries < MAX_RETRIES) {
      sendAgentMessage(msg.content, msg.conversationId, msg.id)
    } else {
      console.error("❌ Message exceeded max retries:", msg)
    }
  })
}

export function addMessageHandler(handler: MessageHandler): () => void {
  messageHandlers.add(handler)
  console.log(`📝 Added message handler (total: ${messageHandlers.size})`)
  
  // Return cleanup function
  return () => {
    messageHandlers.delete(handler)
    console.log(`🗑️ Removed message handler (remaining: ${messageHandlers.size})`)
  }
}

export function sendAgentMessage(content: string, conversationId: string, messageId?: string) {
  const id = messageId || generateMessageId()
  
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("⚠️ WebSocket not connected, queueing message")
    
    // Add to queue
    const queuedMsg: QueuedMessage = {
      id,
      conversationId,
      content,
      timestamp: Date.now(),
      retries: messageId ? messageQueue.find(m => m.id === messageId)?.retries || 0 : 0
    }
    
    // Only add if not already in queue
    if (!messageQueue.find(m => m.id === id)) {
      messageQueue.push(queuedMsg)
      console.log(`📥 Queued message (total: ${messageQueue.length})`)
    }
    
    return id
  }

  const payload = {
    type: "message",
    conversation_id: conversationId,
    content: content,
    message_id: id
  }

  socket.send(JSON.stringify(payload))
  console.log("📤 Message sent via WebSocket:", { conversationId, messageId: id, contentLength: content.length })
  
  // Set up acknowledgment timeout
  const ackTimeout = setTimeout(() => {
    console.warn("⚠️ No ACK received for message, requeueing:", id)
    pendingAcks.delete(id)
    
    // Requeue message with incremented retry count
    const existingMsg = messageQueue.find(m => m.id === id)
    if (existingMsg) {
      existingMsg.retries++
    } else {
      messageQueue.push({
        id,
        conversationId,
        content,
        timestamp: Date.now(),
        retries: 1
      })
    }
    
    // Retry after delay
    if (messageQueue.find(m => m.id === id && m.retries < MAX_RETRIES)) {
      setTimeout(() => {
        const msg = messageQueue.find(m => m.id === id)
        if (msg && socket && socket.readyState === WebSocket.OPEN) {
          sendAgentMessage(msg.content, msg.conversationId, msg.id)
        }
      }, RETRY_DELAY)
    }
  }, 5000) // 5 second timeout for ACK
  
  pendingAcks.set(id, ackTimeout)
  
  return id
}

export function disconnectAgentSocket() {
  if (socket) {
    console.log("👋 Disconnecting agent WebSocket")
    isIntentionalClose = true
    socket.close()
    socket = null
  }
  
  // Clear all handlers
  messageHandlers.clear()
  
  // Clear pending acknowledgments
  pendingAcks.forEach(timeout => clearTimeout(timeout))
  pendingAcks.clear()
  
  // Clear reconnection params
  currentWebsiteId = null
  currentAgentId = null
  
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
}

export function getSocketState() {
  return socket?.readyState
}
