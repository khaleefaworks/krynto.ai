import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useMessageStore } from '@/store/messages'
import { fetchActiveChats as fetchChatsApi } from '@/services/chats'
import { joinChat, closeConversation, takeoverConversation } from '@/services/chats'
import { fetchChatMessages } from '@/services/messages'
import {
    connectAgentSocket,
    sendAgentMessage,
    disconnectAgentSocket,
    addMessageHandler,
} from '@/services/agentSocket'
import {
    addNote,
    getNotes,
    deleteNote,
    type Note
} from '@/services/conversationMetadata'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Send,
    Check,
    Smile,
    Bold,
    Italic,
    Paperclip,
    MessageSquare,
    Search,
    ChevronLeft,
    ChevronRight,
    PanelRightClose,
    PanelRightOpen,
    Inbox,
    Users
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import VisitorDetailsPanel from '@/components/VisitorDetailsPanel'
import { formatDistanceToNow } from 'date-fns'

function getMessageTimestamp(m: any): number {
    const ts = m?.timestamp || m?.created_at
    const t = ts ? new Date(ts).getTime() : NaN
    return Number.isFinite(t) ? t : 0
}

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

type FilterCategory = 'all' | 'mine' | 'unassigned' | 'resolved'

export default function ConversationsView() {
    const { conversationId } = useParams<{ conversationId?: string }>()
    const navigate = useNavigate()
    const { user } = useAppStore()
    const { activeChats, setActiveChats } = useAppStore()
    const { messages, addMessage, addMessages, reset } = useMessageStore()

    // Filter state
    const [activeFilter, setActiveFilter] = useState<FilterCategory>('all')
    const [leftFilterCollapsed, setLeftFilterCollapsed] = useState(() => {
        const saved = localStorage.getItem('chat_left_filter_collapsed')
        return saved ? saved === 'true' : false
    })

    // List state
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    // Chat state
    const [selectedChat, setSelectedChat] = useState<number | null>(null)
    const [input, setInput] = useState('')
    const [chatLoading, setChatLoading] = useState(false)
    const [resolving, setResolving] = useState(false)
    const joinedRef = useRef(false)
    const loadMessagesTokenRef = useRef(0)
    const loadDetailsTokenRef = useRef(0)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Takeover confirmation (Smartsupp-like)
    const [showTakeoverConfirm, setShowTakeoverConfirm] = useState(false)
    const [pendingSendMessage, setPendingSendMessage] = useState<string | null>(null)

    // Conversation details state
    const [conversation, setConversation] = useState<ConversationDetails | null>(null)
    const [notes, setNotes] = useState<Note[]>([])

    // Sidebar collapse state
    const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
        const saved = localStorage.getItem('chat_right_sidebar_collapsed')
        return saved ? saved === 'true' : false
    })

    // Persist collapse preferences
    useEffect(() => {
        localStorage.setItem('chat_left_filter_collapsed', String(leftFilterCollapsed))
    }, [leftFilterCollapsed])

    useEffect(() => {
        localStorage.setItem('chat_right_sidebar_collapsed', String(rightSidebarCollapsed))
    }, [rightSidebarCollapsed])

    // Load chats list and refresh when global notification arrives
    useEffect(() => {
        fetchActiveChats()
    }, [])
    
    // Listen to global notification changes and refresh list (only on ConversationsView)
    const { unreadChatsCount } = useAppStore()
    const lastCountRef = useRef(unreadChatsCount)
    
    useEffect(() => {
        // Only refresh if count actually increased (new chat arrived)
        if (unreadChatsCount > lastCountRef.current) {
            console.log('📨 New chats detected, refreshing chat list...')
            fetchActiveChats()
        }
        lastCountRef.current = unreadChatsCount
    }, [unreadChatsCount])

    // Ensure conversation details populate once chats load (handles refresh on deep links)
    useEffect(() => {
        if (selectedChat && activeChats.length) {
            const chatData = activeChats.find(c => c.id === selectedChat)
            if (chatData) {
                setConversation(chatData as any)
            }
        }
    }, [selectedChat, activeChats])

    // Handle conversation selection from URL
    useEffect(() => {
        if (conversationId && conversationId !== selectedChat?.toString()) {
            setSelectedChat(parseInt(conversationId))
        }
    }, [conversationId])

    // Load chat when selected
    useEffect(() => {
        if (selectedChat && selectedChat.toString() !== conversationId) {
            navigate(`/dashboard/chats/${selectedChat}`)
        }

        if (selectedChat) {
            loadChatData(selectedChat)
            loadConversationDetails(selectedChat)
        }

        return () => {
            if (selectedChat) {
                disconnectAgentSocket()
                joinedRef.current = false
            }
        }
    }, [selectedChat])

    // Setup WebSocket message handler for current chat
    useEffect(() => {
        if (!selectedChat || !user?.id) return

        // Avoid reconnect loops: activeChats refreshes frequently.
        // Website ID for a conversation is stable, so prefer the already-loaded conversation.
        const websiteId = (conversation as any)?.website_id ?? activeChats.find(c => c.id === selectedChat)?.website_id
        if (!websiteId) return

        // Connect socket
        connectAgentSocket(websiteId, user.id)

        // Register message handler
        const removeHandler = addMessageHandler((data) => {
            console.log('📩 WebSocket message received:', data)

            const dataConversationId = Number((data as any)?.conversation_id)
            
            // Only process messages for the current chat
            if (data.type === 'visitor_message' && dataConversationId === selectedChat) {
                // Visitor sent a message - add to UI
                console.log('👤 Adding visitor message to UI:', data.message)
                const newMessage = {
                    id: Date.now(),
                    conversation_id: selectedChat,
                    sender_type: 'visitor' as const,
                    sender: 'visitor' as const,
                    content: data.message,
                    created_at: new Date().toISOString()
                }
                addMessage(newMessage)
            } else if (data.type === 'message_sent' && dataConversationId === selectedChat) {
                // Our message was confirmed - add to UI
                console.log('✅ Agent message confirmed, adding to UI:', data.content)
                const confirmedMessage = {
                    id: Date.now(),
                    conversation_id: selectedChat,
                    sender_type: 'agent' as const,
                    sender: 'agent' as const,
                    content: data.content,
                    created_at: new Date().toISOString()
                }
                addMessage(confirmedMessage)
            } else if (data.type === 'new_conversation') {
                // New conversation arrived - refresh chat list
                console.log('📨 New conversation arrived, refreshing...')
                fetchActiveChats()
            }
        })

        // Cleanup: remove handler when chat changes or component unmounts
        return removeHandler
    }, [selectedChat, user?.id, (conversation as any)?.website_id])

    // Scroll to bottom on new messages - use Layout effect for immediate scroll
    useLayoutEffect(() => {
        // Scroll immediately to bottom (no smooth animation to avoid delay)
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }, [messages, selectedChat])

    const fetchActiveChats = async () => {
        setLoading(true)
        try {
            const chats = await fetchChatsApi()
            setActiveChats(chats)
        } catch (error) {
            console.error("Failed to fetch chats:", error)
        } finally {
            setLoading(false)
        }
    }

    const loadChatData = async (chatId: number) => {
        const token = ++loadMessagesTokenRef.current
        setChatLoading(true)
        reset()

        try {
            const chatMessages = await fetchChatMessages(chatId.toString())

            // If the user switched chats while we were loading, ignore stale results.
            if (loadMessagesTokenRef.current !== token) {
                return
            }
            addMessages(chatMessages)

            // Do NOT auto-join on selection.
            // Joining happens only when the agent actually starts responding (send action).
            const chatData = activeChats.find(c => c.id === chatId)
            joinedRef.current = chatData?.assigned_agent_id === user?.id
        } catch (error) {
            console.error("Failed to load chat:", error)
        } finally {
            if (loadMessagesTokenRef.current === token) {
                setChatLoading(false)
            }
        }
    }

    const loadConversationDetails = async (chatId: number) => {
        const token = ++loadDetailsTokenRef.current
        try {
            const chatData = activeChats.find(c => c.id === chatId)
            if (chatData) {
                setConversation(chatData as any)
            }

            const fetchedNotes = await getNotes(chatId)

            if (loadDetailsTokenRef.current !== token) {
                return
            }
            setNotes(fetchedNotes)
        } catch (error) {
            console.error("Failed to load conversation details:", error)
        }
    }

    const handleChatSelect = (chatId: number) => {
        setSelectedChat(chatId)
    }

    const handleSendMessage = async () => {
        if (!input.trim() || !selectedChat) return

        const messageContent = input.trim()
        setInput('')

        try {
            const chatData = activeChats.find(c => c.id === selectedChat)
            const alreadyJoinedByMe = chatData?.assigned_agent_id === user?.id

            if (!joinedRef.current && !alreadyJoinedByMe) {
                try {
                    await joinChat(selectedChat.toString())
                    joinedRef.current = true

                    // Backend persists an agent-join system message, but the agent UI
                    // doesn't refetch messages on join. Add it locally for immediate UX.
                    addMessage({
                        id: `temp-join-${Date.now()}`,
                        conversation_id: selectedChat,
                        sender_type: 'system' as const,
                        sender: 'system' as const,
                        event_type: 'agent_join',
                        content: `${(user as any)?.name || 'Support Agent'} joined the chat.`,
                        created_at: new Date().toISOString(),
                    } as any)
                } catch (e: any) {
                    // If another agent already owns it, ask for explicit confirmation.
                    const msg = String(e?.message || '')
                    if (msg.toLowerCase().includes('already assigned') || msg.toLowerCase().includes('already')) {
                        setPendingSendMessage(messageContent)
                        setShowTakeoverConfirm(true)
                        return
                    }
                    throw e
                }
            }

            sendAgentMessage(messageContent, selectedChat.toString())
            // Message will appear via WebSocket callback - don't add optimistically
        } catch (error) {
            console.error("Failed to send message:", error)
            // Restore input on error
            setInput(messageContent)
        }
    }

    const confirmTakeoverAndSend = async (confirm: boolean) => {
        const content = pendingSendMessage
        setShowTakeoverConfirm(false)
        setPendingSendMessage(null)

        if (!confirm) {
            if (content) setInput(content)
            return
        }

        if (!selectedChat || !content) return

        try {
            await takeoverConversation(selectedChat)
            joinedRef.current = true

            addMessage({
                id: `temp-join-${Date.now()}`,
                conversation_id: selectedChat,
                sender_type: 'system' as const,
                sender: 'system' as const,
                event_type: 'agent_join',
                content: `${(user as any)?.name || 'Support Agent'} joined the chat.`,
                created_at: new Date().toISOString(),
            } as any)

            sendAgentMessage(content, selectedChat.toString())
        } catch (error) {
            console.error('Failed to takeover and send:', error)
            setInput(content)
        }
    }

    const handleResolve = async () => {
        if (!selectedChat) return

        setResolving(true)
        try {
            await closeConversation(selectedChat)
            setActiveChats(activeChats.filter(c => c.id !== selectedChat))
            setSelectedChat(null)
            navigate('/dashboard/chats')
        } catch (error) {
            console.error("Failed to resolve chat:", error)
        } finally {
            setResolving(false)
        }
    }

    const handleAddNote = async (content: string) => {
        if (!selectedChat) return
        try {
            const newNote = await addNote(selectedChat, content)
            setNotes(prev => [...prev, newNote])
        } catch (error) {
            console.error("Failed to add note:", error)
        }
    }

    const handleDeleteNote = async (noteId: number) => {
        if (!selectedChat) return
        try {
            await deleteNote(selectedChat, noteId)
            setNotes(prev => prev.filter(n => n.id !== noteId))
        } catch (error) {
            console.error("Failed to delete note:", error)
        }
    }

    const filteredChats = activeChats.filter(chat => {
        // Apply search filter
        if (searchQuery && !chat.session_id.toLowerCase().includes(searchQuery.toLowerCase())) {
            return false
        }

        // Apply category filter
        switch (activeFilter) {
            case 'all':
                return chat.status === 'open'
            case 'mine':
                return chat.status === 'open' && (chat as any).assigned_agent_id === user?.id
            case 'unassigned':
                return chat.status === 'open' && (chat as any).assigned_agent_id == null
            case 'resolved':
                return chat.status === 'resolved'
            default:
                return chat.status === 'open'
        }
    })

    const getFilterHeaderText = () => {
        switch (activeFilter) {
            case 'all':
                return 'All Chats'
            case 'mine':
                return 'My Chats'
            case 'unassigned':
                return 'Unassigned'
            case 'resolved':
                return 'Resolved'
            default:
                return 'All Chats'
        }
    }

    const getFilterIcon = () => {
        switch (activeFilter) {
            case 'all':
                return <MessageSquare className="h-5 w-5" />
            case 'mine':
                return <Users className="h-5 w-5" />
            case 'unassigned':
                return <Inbox className="h-5 w-5" />
            case 'resolved':
                return <Check className="h-5 w-5" />
            default:
                return <MessageSquare className="h-5 w-5" />
        }
    }

    return (
        <div className="flex h-full w-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            {showTakeoverConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            Another agent has already joined the chat
                        </h3>
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                            If you send the message, you'll join the chat. Are you sure you want to send the message?
                        </p>

                        <div className="mt-6 flex justify-end gap-2">
                            <Button variant="outline" onClick={() => confirmTakeoverAndSend(false)}>
                                No
                            </Button>
                            <Button onClick={() => confirmTakeoverAndSend(true)}>
                                Yes
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            {/* COLUMN 1: Filter/Category Sidebar */}
            <div className={`bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-300 ease-in-out ${leftFilterCollapsed ? 'w-20' : 'w-52'
                }`}
            >
                <div className="h-16 p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    {!leftFilterCollapsed && (
                        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Filters</h3>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLeftFilterCollapsed(!leftFilterCollapsed)}
                        className="dark:text-gray-300"
                        title={leftFilterCollapsed ? "Expand filters" : "Collapse filters"}
                    >
                        {leftFilterCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {/* OPEN Section */}
                    <div className="p-2">
                        {!leftFilterCollapsed && (
                            <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase px-3 py-2">Open</h4>
                        )}

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('all')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'all'
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <MessageSquare className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open').length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <MessageSquare className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">All</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open').length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">All</TooltipContent>}
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('mine')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'mine'
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Users className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open' && (c as any).assigned_agent_id === user?.id).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Users className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">Mine</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open' && (c as any).assigned_agent_id === user?.id).length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">My Chats</TooltipContent>}
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('unassigned')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'unassigned'
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Inbox className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open' && (c as any).assigned_agent_id == null).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Inbox className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">Unassigned</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open' && (c as any).assigned_agent_id == null).length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">Unassigned</TooltipContent>}
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    {/* Separator */}
                    <div className={`border-t border-gray-200 dark:border-gray-700 ${leftFilterCollapsed ? 'mx-2' : 'mx-4'} my-2`} />

                    {/* RESOLVED Section */}
                    <div className="p-2">
                        {!leftFilterCollapsed && (
                            <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase px-3 py-2">Resolved</h4>
                        )}

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('resolved')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'resolved'
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Check className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'resolved').length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Check className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">Resolved</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'resolved').length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">Resolved</TooltipContent>}
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            </div>

            {/* COLUMN 2: Conversations List */}
            <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
                {/* Header */}
                <div>
                    <div className='h-16 p-4 border-b border-gray-200 dark:border-gray-700'>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            {getFilterIcon()}
                            {getFilterHeaderText()}
                        </h2>
                    </div>

                    {/* Search */}
                    <div className="relative p-4 border-b border-gray-200 dark:border-gray-700">
                        <Search className="absolute left-7 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 dark:bg-gray-700 dark:border-gray-600"
                        />
                    </div>

                    <p className="text-sm text-gray-500 dark:text-gray-400 px-4 py-2">
                        {filteredChats.length} conversation{filteredChats.length !== 1 ? 's' : ''}
                    </p>
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-32">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : filteredChats.length === 0 ? (
                        <div className="text-center p-8 text-gray-400 dark:text-gray-600">
                            <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>You don't have any {activeFilter !== 'all' ? activeFilter : ''} conversations at the moment.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredChats.map((chat) => (
                                <button
                                    key={chat.id}
                                    onClick={() => handleChatSelect(chat.id)}
                                    className={`w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${selectedChat === chat.id ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-600' : ''
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold flex-shrink-0 relative">
                                            {chat.session_id.substring(0, 2).toUpperCase()}
                                            {(chat as any).assigned_agent_id && (
                                                <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-800" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-semibold text-gray-900 dark:text-white truncate">
                                                    {chat.session_id.substring(0, 8)}...
                                                </span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                    {(chat as any).created_at
                                                        ? formatDistanceToNow(new Date((chat as any).created_at), { addSuffix: true })
                                                        : ''}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                                                {(chat as any).last_message || 'No messages yet'}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* COLUMN 3: Chat Messages */}
            {selectedChat ? (
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Chat Header */}
                    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                                    {conversation?.session_id?.substring(0, 2).toUpperCase() || 'VI'}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                                        {conversation?.visitor_name || conversation?.session_id.substring(0, 8) || `Chat #${selectedChat}`}
                                    </h2>
                                    {conversation?.last_seen_at && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                            Last seen {formatDistanceToNow(new Date(conversation.last_seen_at), { addSuffix: true })}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Header Actions */}
                            <div className="flex items-center gap-2 flex-shrink-0">
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
                            </div>
                        </div>

                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
                        {chatLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-2"></div>
                                    <p className="text-gray-500 dark:text-gray-400">Loading messages...</p>
                                </div>
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-600">
                                <div className="text-center">
                                    <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p className="text-lg">No messages yet</p>
                                    <p className="text-sm mt-2">Start the conversation!</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {[...messages]
                                    .sort((a: any, b: any) => getMessageTimestamp(a) - getMessageTimestamp(b))
                                    .map((msg, index, sortedMessages) => {
                                    const senderType = (msg as any).sender_type || (msg as any).sender || 'system'
                                    const eventType = (msg as any).event_type || null
                                    const isSystem = senderType === 'system'
                                    const isJoin = isSystem && eventType === 'agent_join'
                                    const isBot = isSystem && !isJoin
                                    const isAgent = senderType === 'agent'
                                    const msgTimestamp = (msg as any).timestamp || msg.created_at
                                    const showTimestamp = index === 0 ||
                                        (new Date(msgTimestamp).getTime() - new Date((sortedMessages[index - 1] as any).timestamp || (sortedMessages[index - 1] as any).created_at).getTime() > 300000)

                                    return (
                                        <div key={msg.id}>
                                            {/* Timestamp Divider */}
                                            {showTimestamp && (
                                                <div className="flex items-center justify-center my-4">
                                                    <div className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-400">
                                                        {new Date(msgTimestamp).toLocaleString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Agent Joined */}
                                            {isJoin ? (
                                                <div className="flex justify-center">
                                                    <div className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300">
                                                        {msg.content}
                                                    </div>
                                                </div>
                                            ) : isBot ? (
                                                <div className="flex justify-start">
                                                    <div className="flex items-end gap-2 max-w-[70%]">
                                                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-700 dark:text-gray-200 text-xs font-bold flex-shrink-0">
                                                            AI
                                                        </div>
                                                        <div className="group relative bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-2xl px-4 py-2 shadow-sm border border-gray-200 dark:border-gray-700">
                                                            <p className="break-words whitespace-pre-wrap">{msg.content}</p>
                                                            <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                                <span>{new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                                                    <div className="flex items-end gap-2 max-w-[70%]">
                                                        {!isAgent && (
                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                                                {conversation?.session_id?.substring(0, 2).toUpperCase() || 'VI'}
                                                            </div>
                                                        )}
                                                        <div className={`group relative ${isAgent ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'} rounded-2xl px-4 py-2 shadow-sm`}>
                                                            <p className="break-words whitespace-pre-wrap">{msg.content}</p>
                                                            <div className={`flex items-center gap-1 mt-1 text-xs ${isAgent ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                                                <span>{new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                {isAgent && (
                                                                    <Check className="h-3 w-3 ml-1" />
                                                                )}
                                                            </div>
                                                        </div>
                                                        {isAgent && (
                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                                                {(user as any)?.name?.substring(0, 2).toUpperCase() || 'AG'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                                <div ref={messagesEndRef} />
                            </>
                        )}
                    </div>

                    {/* Input Area */}
                    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 flex-shrink-0">
                        <div className="flex gap-2 mb-2">
                            <Button variant="ghost" size="sm" className="dark:text-gray-400">
                                <Bold className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="dark:text-gray-400">
                                <Italic className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="dark:text-gray-400">
                                <Smile className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="dark:text-gray-400">
                                <Paperclip className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault()
                                        handleSendMessage()
                                    }
                                }}
                                placeholder="Reply to live chat"
                                className="flex-1 dark:bg-gray-700 dark:border-gray-600"
                            />
                            <Button
                                onClick={handleSendMessage}
                                disabled={!input.trim()}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                <Send className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                /* Empty State */
                <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="text-center text-gray-400 dark:text-gray-600 max-w-2xl px-8">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                            <MessageSquare className="h-12 w-12 text-white" />
                        </div>
                        <h2 className="text-2xl font-semibold mb-4 text-gray-700 dark:text-gray-300">Have a moment?</h2>
                        <p className="text-gray-500 dark:text-gray-400 mb-8">
                            Great! Use the spare time and learn some of the best practices for using AI ChatAssist.
                        </p>

                        <div className="space-y-4 text-left">
                            <div className="flex gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg">
                                <div className="flex-shrink-0">
                                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                                        <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Customize the chat box to match your website</h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        With a good profile picture, personalized brand colors, and friendly texts, you'll make the right impression.
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg">
                                <div className="flex-shrink-0">
                                    <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                                        <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Discover how the live chat works</h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        We'll show you how to work with the live chat and you'll be able to attend to your first visitor in no time.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* COLUMN 4: Visitor Details (Collapsible) */}
            {selectedChat && conversation && (
                <div
                    className={`bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex-shrink-0 transition-all duration-300 ease-in-out ${rightSidebarCollapsed ? 'w-16' : 'w-80'} flex`}
                >
                    {rightSidebarCollapsed ? (
                        <div className="h-full flex flex-col items-center gap-4 py-4 px-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setRightSidebarCollapsed(false)}
                                className="dark:text-gray-300"
                                title="Show visitor details"
                            >
                                <PanelRightOpen className="h-4 w-4" />
                            </Button>
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 text-white flex items-center justify-center text-sm font-semibold">
                                {(conversation?.visitor_name || conversation?.session_id || 'VI').substring(0, 2).toUpperCase()}
                            </div>
                        </div>
                    ) : (
                        <div className="flex h-full flex-col w-full">
                            <div className="flex items-center justify-end gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setRightSidebarCollapsed(true)}
                                    className="dark:text-gray-300"
                                    title="Hide visitor details"
                                >
                                    <PanelRightClose className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="flex-1 min-w-0">
                                <VisitorDetailsPanel
                                    conversation={conversation}
                                    notes={notes.map(note => ({
                                        ...note,
                                        creator_name: note.creator_name || 'Unknown'
                                    }))}
                                    onAddNote={handleAddNote}
                                    onDeleteNote={handleDeleteNote}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
