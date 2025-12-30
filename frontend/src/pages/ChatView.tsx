import { useEffect, useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useAppStore } from "@/store/appStore"
import { useMessageStore } from "@/store/messages"
import { closeConversation } from "@/services/chats"
import {
  connectAgentSocket,
  sendAgentMessage,
  disconnectAgentSocket,
  getSocketState,
} from "@/services/agentSocket"
import { 
  addTag, 
  getTags, 
  deleteTag, 
  addNote, 
  getNotes, 
  deleteNote,
  updateConversationMetadata,
  type Tag,
  type Note
} from "@/services/conversationMetadata"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  ArrowLeft, 
  Send, 
  Check, 
  MoreVertical, 
  Tag as TagIcon,
  Smile,
  Bold,
  Italic,
  Paperclip,
  Clock
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import VisitorDetailsPanel from "@/components/VisitorDetailsPanel"
import { formatDistanceToNow } from "date-fns"

interface ConversationDetails {
  id: number
  session_id: string
  visitor_name?: string
  visitor_email?: string
  visitor_phone?: string
  device_info?: string
  browser_info?: string
  visit_count?: number
  last_seen_at?: string
  created_at?: string
  status?: string
}

export default function ChatView() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { user, activeChats } = useAppStore()
  const { messages, addMessage, addMessages, reset } = useMessageStore()
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(false)
  const joinedRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // Conversation details state
  const [conversation, setConversation] = useState<ConversationDetails | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [websiteId, setWebsiteId] = useState<number | null>(null)
  const [showRightSidebar, setShowRightSidebar] = useState(true)

  useEffect(() => {
    let ws: WebSocket | null = null
    let isSubscribed = true

    async function init() {
      if (!conversationId || !user || joinedRef.current) return
      
      joinedRef.current = true
      reset()
      setLoading(true)
      setConnectionError(null)

      try {
        const chatMeta = activeChats.find((c) => c.id === parseInt(conversationId))
        if (!chatMeta) {
          setConnectionError("Chat not found in active list. Please return to the inbox and retry.")
          setLoading(false)
          return
        }

        if (isSubscribed) {
          setWebsiteId(chatMeta.website_id)
          setConversation({
            id: chatMeta.id,
            session_id: chatMeta.session_id,
            visitor_name: undefined,
            visitor_email: undefined,
            visitor_phone: undefined,
            device_info: "",
            browser_info: "",
            visit_count: undefined,
            last_seen_at: new Date().toISOString(),
            created_at: chatMeta.created_at || new Date().toISOString(),
            status: chatMeta.status,
          })
        }

        if (!isSubscribed) return

        // Connect agent WebSocket first, then join via WS
        ws = connectAgentSocket(chatMeta.website_id, user.id)
        socketRef.current = ws

        ws.onopen = () => {
          console.log("✅ Agent WebSocket connected")
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
            if (isSubscribed) {
              // Replace local messages with server history
              addMessages(
                (data.history || []).map((m: any) => ({
                  sender: m.sender,
                  content: m.content,
                  created_at: m.created_at,
                }))
              )
              loadTagsAndNotes(conversationId)
              setLoading(false)
            }
          } else if (data.type === "visitor_message") {
            // Visitor message received
            addMessage({
              sender: "visitor",
              content: data.message,
              created_at: new Date().toISOString(),
            })
            // Update last seen
            if (conversation) {
              setConversation({ ...conversation, last_seen_at: new Date().toISOString() })
            }
          } else if (data.type === "message") {
            // Generic message format
            addMessage({
              id: data.id,
              sender: data.sender || "visitor",
              content: data.content || data.message,
              created_at: data.created_at,
            })
          } else if (data.type === "error") {
            setConnectionError(data.message || "WebSocket error")
            setLoading(false)
          }
        }

        ws.onerror = (error) => {
          console.error("❌ WebSocket error:", error)
          setConnectionError("WebSocket error. Please reconnect.")
          setLoading(false)
        }

        ws.onclose = () => {
          console.log("🔌 Agent WebSocket closed")
          setConnectionError("WebSocket disconnected")
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
      socketRef.current = null
      disconnectAgentSocket()
    }
  }, [conversationId, user?.id, activeChats])

  const loadTagsAndNotes = async (convId: string) => {
    try {
      const [tagsData, notesData] = await Promise.all([
        getTags(parseInt(convId)),
        getNotes(parseInt(convId))
      ])
      setTags(tagsData)
      setNotes(notesData)
    } catch (error) {
      console.error("Failed to load tags/notes:", error)
    }
  }

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleResolve = async () => {
    if (!conversationId) return
    
    if (!confirm("Mark this conversation as resolved?")) {
      return
    }

    try {
      setResolving(true)
      await closeConversation(parseInt(conversationId))
      navigate("/dashboard/chats")
    } catch (error) {
      console.error("Failed to resolve conversation:", error)
      alert("Failed to resolve conversation")
    } finally {
      setResolving(false)
    }
  }

  const send = () => {
    if (!input.trim() || !conversationId) return

    // Ensure socket is connected before sending
    const state = getSocketState()
    if (state !== WebSocket.OPEN) {
      setConnectionError("WebSocket not connected. Please reconnect and try again.")
      return
    }

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

  // Handler functions for VisitorDetailsPanel
  const handleUpdateMetadata = async (data: { visitor_name?: string; visitor_email?: string; visitor_phone?: string }) => {
    if (!conversationId) return
    try {
      await updateConversationMetadata(parseInt(conversationId), data)
      setConversation(prev => prev ? { ...prev, ...data } : null)
    } catch (error) {
      console.error("Failed to update metadata:", error)
    }
  }

  const handleAddTag = async (tagName: string) => {
    if (!conversationId) return
    try {
      const newTag = await addTag(parseInt(conversationId), tagName)
      setTags(prev => [...prev, newTag])
    } catch (error) {
      console.error("Failed to add tag:", error)
    }
  }

  const handleRemoveTag = async (tagId: number) => {
    if (!conversationId) return
    try {
      await deleteTag(parseInt(conversationId), tagId)
      setTags(prev => prev.filter(t => t.id !== tagId))
    } catch (error) {
      console.error("Failed to remove tag:", error)
    }
  }

  const handleAddNote = async (content: string) => {
    if (!conversationId) return
    try {
      const newNote = await addNote(parseInt(conversationId), content)
      setNotes(prev => [...prev, newNote])
    } catch (error) {
      console.error("Failed to add note:", error)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!conversationId) return
    try {
      await deleteNote(parseInt(conversationId), noteId)
      setNotes(prev => prev.filter(n => n.id !== noteId))
    } catch (error) {
      console.error("Failed to delete note:", error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Connecting to chat...</p>
        </div>
      </div>
    )
  }

  const connectionBanner = connectionError ? (
    <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm border-b border-red-200 dark:border-red-800">
      {connectionError}
    </div>
  ) : null

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {connectionBanner}
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/dashboard/chats")}
                className="dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {conversation?.visitor_name || conversation?.session_id.substring(0, 8) || `Chat #${conversationId}`}
                </h2>
                {conversation?.last_seen_at && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Last seen {formatDistanceToNow(new Date(conversation.last_seen_at), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              {/* Tag Button */}
              <Button
                variant="ghost"
                size="sm"
                className="dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <TagIcon className="h-4 w-4 mr-1" />
                Tag conversation
              </Button>

              {/* Resolve Button */}
              <Button
                variant="default"
                size="sm"
                onClick={handleResolve}
                disabled={resolving}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Check className="h-4 w-4 mr-1" />
                {resolving ? "Resolving..." : "Resolve"}
              </Button>

              {/* More Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="dark:text-gray-300">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowRightSidebar(!showRightSidebar)}>
                    {showRightSidebar ? "Hide" : "Show"} visitor details
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-red-600">
                    Close conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Tags Display */}
          {tags.length > 0 && (
            <div className="flex gap-2 mt-2">
              {tags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="text-xs">
                  {tag.tag_name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
          {messages.length === 0 && (
            <p className="text-center text-gray-400 dark:text-gray-600 text-sm mt-8">
              Waiting for messages...
            </p>
          )}
          
          {messages.map((m, i) => {
            const isSystem = m.sender === "system"
            const isAgent = m.sender === "agent"
            const isVisitor = m.sender === "visitor"
            const isAI = m.sender === "ai"

            // System messages
            if (isSystem) {
              return (
                <div key={i} className="flex justify-center">
                  <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-4 py-2 rounded-full text-xs font-medium">
                    {m.content}
                  </div>
                </div>
              )
            }

            return (
              <div
                key={i}
                className={`flex ${isAgent ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-3 shadow-sm ${
                    isAgent
                      ? "bg-blue-600 text-white dark:bg-blue-500"
                      : "bg-white text-gray-800 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700"
                  }`}
                >
                  <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{m.content}</p>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    {!isAgent && (
                      <span className={`text-xs font-medium ${isAgent ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                        {isAI ? '🤖 AI' : '👤 Visitor'}
                      </span>
                    )}
                    {m.created_at && (
                      <span className={`text-xs ${isAgent ? 'text-blue-100' : 'text-gray-400 dark:text-gray-500'} ml-auto`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area with Toolbar */}
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          {/* Formatting Toolbar */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 dark:hover:bg-gray-700">
              <Bold className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 dark:hover:bg-gray-700">
              <Italic className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 dark:hover:bg-gray-700">
              <Smile className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 dark:hover:bg-gray-700">
              <Paperclip className="h-4 w-4" />
            </Button>
            <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
              Press Enter to send
            </div>
          </div>

          {/* Message Input */}
          <div className="flex gap-3 p-4">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              className="flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
            />
            <Button 
              onClick={send} 
              disabled={!input.trim()} 
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 px-6"
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Visitor Details */}
      {showRightSidebar && conversation && (
        <VisitorDetailsPanel
          conversation={conversation}
          tags={tags}
          notes={notes}
          onUpdateMetadata={handleUpdateMetadata}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onAddNote={handleAddNote}
          onDeleteNote={handleDeleteNote}
        />
      )}
    </div>
  )
}


