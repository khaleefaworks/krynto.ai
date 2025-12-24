import { useAppStore } from "../store/appStore"

let socket: WebSocket | null = null

export function connectAgentSocket(websiteId: number, agentId: number) {
  // Return existing socket if already connected
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("♻️ Reusing existing WebSocket connection")
    return socket
  }

  // Close any existing socket in bad state
  if (socket) {
    socket.close()
    socket = null
  }

  const token = useAppStore.getState().token

  if (!token) {
    throw new Error("Not authenticated")
  }

  const wsUrl = `ws://localhost:8000/ws/agent/${websiteId}/${agentId}`
  socket = new WebSocket(wsUrl)

  socket.onclose = () => {
    console.log("🔌 WebSocket closed, clearing reference")
    socket = null
  }

  return socket
}

export function sendAgentMessage(message: string, conversationId: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("❌ WebSocket not connected, cannot send message")
    return
  }

  socket.send(
    JSON.stringify({
      type: "message",
      conversation_id: conversationId,
      content: message,
    })
  )
}

export function disconnectAgentSocket() {
  if (socket) {
    console.log("👋 Disconnecting agent WebSocket")
    socket.close()
    socket = null
  }
}

export function getSocketState() {
  return socket?.readyState
}
