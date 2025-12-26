import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { fetchChatMessages } from "@/services/messages"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"

interface Message {
  id?: number
  sender: string
  content: string
  created_at?: string
}

export default function ClosedChatView() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadHistory() {
      if (!conversationId) return
      
      setLoading(true)
      try {
        const history = await fetchChatMessages(conversationId)
        setMessages(history)
      } catch (error) {
        console.error("Failed to load conversation history:", error)
      } finally {
        setLoading(false)
      }
    }

    loadHistory()
  }, [conversationId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Loading conversation...</p>
      </div>
    )
  }

  return (
    <div>
      <Button
        variant="ghost"
        onClick={() => navigate("/dashboard/history")}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to History
      </Button>

      <Card className="h-[calc(100vh-12rem)]">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex justify-between items-center">
            <CardTitle>Closed Conversation #{conversationId}</CardTitle>
            <span className="text-sm text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
              Read Only
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex flex-col h-full">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.length === 0 && (
              <p className="text-center text-gray-400 text-sm">
                No messages in this conversation
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
                  className={`max-w-[70%] rounded-lg px-4 py-2 shadow-sm ${
                    m.sender === "agent"
                      ? "bg-black text-white"
                      : m.sender === "ai"
                      ? "bg-gray-200 text-gray-800"
                      : "bg-blue-100 text-blue-900"
                  }`}
                >
                  <p className="text-sm">{m.content}</p>
                  <div className="flex items-center justify-between mt-1">
                    {m.sender !== "agent" && (
                      <span className="text-xs opacity-70 capitalize">
                        {m.sender}
                      </span>
                    )}
                    {m.created_at && (
                      <span className="text-xs opacity-60 ml-2">
                        {new Date(m.created_at).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer Info */}
          <div className="border-t p-4 bg-gray-100 text-center text-sm text-gray-600">
            This conversation is closed and cannot be replied to
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
