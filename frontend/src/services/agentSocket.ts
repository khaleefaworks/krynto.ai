import { useAppStore } from "../store/appStore"

let socket: WebSocket | null = null
let reconnectTimeout: NodeJS.Timeout | null = null
let currentWebsiteId: number | null = null
let currentAgentId: number | null = null
let isIntentionalClose = false

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

  const wsUrl = `ws://localhost:8000/ws/agent/${websiteId}/${agentId}`
  console.log("🔌 Connecting to WebSocket:", wsUrl)
  socket = new WebSocket(wsUrl)

  socket.onopen = () => {
    console.log("✅ WebSocket connected")
    // Clear any pending reconnect
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
  }

  socket.onclose = (event) => {
    console.log("🔌 WebSocket closed", event.code, event.reason)
    socket = null
    
    // Only auto-reconnect if not intentional and connection params exist
    if (!isIntentionalClose && event.code !== 1000 && currentWebsiteId && currentAgentId) {
      console.log("🔄 Will attempt reconnect in 3 seconds...")
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      reconnectTimeout = setTimeout(() => {
        console.log("🔄 Reconnecting...")
        connectAgentSocket(currentWebsiteId!, currentAgentId!)
      }, 3000)
    }
  }

  socket.onerror = (error) => {
    console.error("❌ WebSocket error:", error)
  }

  return socket
}

export function sendAgentMessage(content: string, conversationId: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("❌ WebSocket not connected, cannot send message")
    throw new Error("WebSocket not connected")
  }

  socket.send(
    JSON.stringify({
      type: "message",
      conversation_id: conversationId,
      content: content,
    })
  )
  
  console.log("📤 Message sent via WebSocket:", { conversationId, contentLength: content.length })
}

export function disconnectAgentSocket() {
  if (socket) {
    console.log("👋 Disconnecting agent WebSocket")
    isIntentionalClose = true
    socket.close()
    socket = null
  }
  
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
