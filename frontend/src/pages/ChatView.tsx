import { useEffect, useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useAppStore } from "@/store/appStore"
import { useMessageStore } from "@/store/messages"
import { joinChat, closeConversation } from "@/services/chats"
import { fetchChatMessages } from "@/services/messages"
import {
  connectAgentSocket,
  sendAgentMessage,
  disconnectAgentSocket,
} from "@/services/agentSocket"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Send, X } from "lucide-react"

export default function ChatView() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { agent } = useAppStore()
  const { messages, addMessage, addMessages, reset } = useMessageStore()
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const joinedRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let ws: WebSocket | null = null
    let isSubscribed = true

    async function init() {
      if (!conversationId || !agent || joinedRef.current) return
      
      joinedRef.current = true
      reset()
      setLoading(true)

      try {
        // 1. Load existing chat history via REST
        const history = await fetchChatMessages(conversationId)
        if (isSubscribed) {
          addMessages(history)
        }

        // 2. Join chat (pauses AI, assigns agent)
        const res: any = await joinChat(conversationId)
        console.log("✅ Joined chat:", res)

        if (!isSubscribed) return

        // 3. Connect agent WebSocket
        ws = connectAgentSocket(res.website_id, agent.id)

        ws.onopen = () => {
          console.log("✅ Agent WebSocket connected")
          setLoading(false)
          
          // Send join_chat message to backend
          ws!.send(
            JSON.stringify({
              type: "join_chat",
              conversation_id: parseInt(conversationId),
            })
          )
        }

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)
          console.log("📥 Received:", data)

          if (data.type === "joined") {
            console.log("✅ Successfully joined conversation")
            // History already loaded via REST, no need to process it again
          } else if (data.type === "visitor_message") {
            // Visitor message received
            addMessage({
              sender: "visitor",
              content: data.message,
              created_at: new Date().toISOString(),
            })
          } else if (data.type === "message") {
            // Generic message format
            addMessage({
              id: data.id,
              sender: data.sender || "visitor",
              content: data.content || data.message,
              created_at: data.created_at,
            })
          }
        }

        ws.onerror = (error) => {
          console.error("❌ WebSocket error:", error)
        }

        ws.onclose = () => {
          console.log("🔌 Agent WebSocket closed")
        }
      } catch (error) {
        console.error("Failed to initialize chat:", error)
        setLoading(false)
      }
    }

    init()

    return () => {
      isSubscribed = false
      joinedRef.current = false
      disconnectAgentSocket()
    }
  }, [conversationId, agent?.id])

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleCloseConversation = async () => {
    if (!conversationId) return
    
    if (!confirm("Are you sure you want to close this conversation? This action cannot be undone.")) {
      return
    }

    try {
      setClosing(true)
      await closeConversation(parseInt(conversationId))
      alert("Conversation closed successfully")
      navigate("/dashboard/chats")
    } catch (error) {
      console.error("Failed to close conversation:", error)
      alert("Failed to close conversation")
    } finally {
      setClosing(false)
    }
  }

  const send = () => {
    if (!input.trim() || !conversationId) return

    sendAgentMessage(input, conversationId)
    
    // Add to local state immediately (optimistic update)
    addMessage({ 
      sender: "agent", 
      content: input,
      created_at: new Date().toISOString(),
    })
    
    setInput("")
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Connecting to chat...</p>
      </div>
    )
  }

  return (
    <div>
      <Button
        variant="ghost"
        onClick={() => navigate("/dashboard/chats")}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Chats
      </Button>

      <Card className="h-[calc(100vh-12rem)]">
        <CardHeader className="border-b">
          <div className="flex justify-between items-center">
            <CardTitle>Chat #{conversationId}</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCloseConversation}
              disabled={closing}
              className="text-red-600 hover:bg-red-50"
            >
              <X className="h-4 w-4 mr-2" />
              {closing ? "Closing..." : "Close Conversation"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex flex-col h-full">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-center text-gray-400 text-sm">
                Waiting for messages...
              </p>
            )}
            
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${
                  m.sender === "agent" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    m.sender === "agent"
                      ? "bg-black text-white"
                      : m.sender === "ai"
                      ? "bg-gray-200 text-gray-800"
                      : "bg-blue-100 text-blue-900"
                  }`}
                >
                  <p className="text-sm">{m.content}</p>
                  {m.sender !== "agent" && (
                    <span className="text-xs opacity-70 mt-1 block">
                      {m.sender}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1"
              />
              <Button onClick={send} disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


