import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Send, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function ChatView() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { agent, messages, setMessages, addMessage, ws, setWebSocket, setConnected } = useAppStore()
  
  const [messageInput, setMessageInput] = useState('')
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!conversationId || !agent) return

    // Fetch conversation history
    fetchMessages()

    // Join the chat
    joinChat()

    // Connect to WebSocket
    connectWebSocket()

    return () => {
      // Cleanup WebSocket on unmount
      if (ws) {
        ws.close()
        setWebSocket(null)
        setConnected(false)
      }
    }
  }, [conversationId])

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    scrollToBottom()
  }, [messages])

  const fetchMessages = async () => {
    try {
      const response = await fetch(`http://localhost:8000/chats/${conversationId}/messages`)
      const data = await response.json()
      setMessages(data)
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    } finally {
      setLoading(false)
    }
  }

  const joinChat = async () => {
    try {
      await fetch(`http://localhost:8000/chats/${conversationId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent!.id }),
      })
    } catch (error) {
      console.error('Failed to join chat:', error)
    }
  }

  const connectWebSocket = () => {
    // Use website_id = 1 for now (TODO: get from conversation)
    const websiteId = 1
    const wsUrl = `ws://localhost:8000/ws/agent/${websiteId}/${agent!.id}`
    
    const websocket = new WebSocket(wsUrl)

    websocket.onopen = () => {
      console.log('✅ Agent WebSocket connected')
      setConnected(true)
      
      // Send join message
      websocket.send(JSON.stringify({
        type: 'join_chat',
        conversation_id: parseInt(conversationId!),
      }))
    }

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('📥 Received:', data)

      if (data.type === 'joined') {
        console.log('Joined chat successfully')
      } else if (data.type === 'visitor_message') {
        // Add visitor message to chat
        const newMessage = {
          id: Date.now(),
          conversation_id: parseInt(conversationId!),
          sender: 'visitor' as const,
          content: data.message,
          created_at: new Date().toISOString(),
        }
        addMessage(newMessage)
      }
    }

    websocket.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }

    websocket.onclose = () => {
      console.log('🔌 WebSocket disconnected')
      setConnected(false)
    }

    setWebSocket(websocket)
  }

  const sendMessage = () => {
    if (!messageInput.trim() || !ws || !conversationId) return

    const messageData = {
      type: 'message',
      conversation_id: parseInt(conversationId),
      content: messageInput,
    }

    ws.send(JSON.stringify(messageData))

    // Add to local state immediately
    const newMessage = {
      id: Date.now(),
      conversation_id: parseInt(conversationId),
      sender: 'agent' as const,
      content: messageInput,
      created_at: new Date().toISOString(),
    }
    addMessage(newMessage)

    setMessageInput('')
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

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
        onClick={() => navigate('/dashboard/chats')}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Chats
      </Button>

      <Card className="h-[calc(100vh-12rem)]">
        <CardHeader className="border-b">
          <CardTitle>Chat #{conversationId}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex flex-col h-full">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.sender === 'agent' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    msg.sender === 'agent'
                      ? 'bg-blue-600 text-white'
                      : msg.sender === 'ai'
                      ? 'bg-gray-200 text-gray-900'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <div className="text-xs opacity-75 mb-1">
                    {msg.sender === 'agent' ? 'You' : msg.sender === 'ai' ? 'AI' : 'Visitor'}
                  </div>
                  <div className="text-sm">{msg.content}</div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1"
              />
              <Button onClick={sendMessage} disabled={!messageInput.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
