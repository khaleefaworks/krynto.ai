import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useMessageStore } from '@/store/messages'
import { fetchActiveChats as fetchChatsApi } from '@/services/chats'
import { joinChat, closeConversation } from '@/services/chats'
import { fetchChatMessages } from '@/services/messages'
import {
    connectAgentSocket,
    sendAgentMessage,
    disconnectAgentSocket,
} from '@/services/agentSocket'
import {
    addTag,
    getTags,
    deleteTag,
    addNote,
    getNotes,
    deleteNote,
    type Tag,
    type Note
} from '@/services/conversationMetadata'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Send,
    Check,
    MoreVertical,
    Tag as TagIcon,
    Smile,
    Bold,
    Italic,
    Paperclip,
    MessageSquare,
    Search,
    ChevronLeft,
    ChevronRight,
    PanelRightClose,
    Sparkles,
    Inbox,
    Users,
    Bot
} from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import VisitorDetailsPanel from '@/components/VisitorDetailsPanel'
import { formatDistanceToNow } from 'date-fns'

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

type FilterCategory = 'all' | 'ai' | 'new' | 'agent' | 'ai-resolved'

export default function ConversationsView() {
    const { conversationId } = useParams<{ conversationId?: string }>()
    const navigate = useNavigate()
    const { user } = useAppStore()
    const { activeChats, setActiveChats } = useAppStore()
    const { messages, addMessage, addMessages, reset } = useMessageStore()

    // Filter state
    const [activeFilter, setActiveFilter] = useState<FilterCategory>('all')
    const [leftFilterCollapsed, setLeftFilterCollapsed] = useState(false)

    // List state
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    // Chat state
    const [selectedChat, setSelectedChat] = useState<number | null>(null)
    const [input, setInput] = useState('')
    const [chatLoading, setChatLoading] = useState(false)
    const [resolving, setResolving] = useState(false)
    const joinedRef = useRef(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Conversation details state
    const [conversation, setConversation] = useState<ConversationDetails | null>(null)
    const [tags, setTags] = useState<Tag[]>([])
    const [notes, setNotes] = useState<Note[]>([])

    // Sidebar collapse state
    const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)

    // Load chats list
    useEffect(() => {
        fetchActiveChats()
    }, [])

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

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

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
        setChatLoading(true)
        reset()

        try {
            const chatMessages = await fetchChatMessages(chatId.toString())
            addMessages(chatMessages)

            if (!joinedRef.current && user?.id) {
                const joined = await joinChat(chatId.toString())
                if (joined) {
                    const chatData = activeChats.find(c => c.id === chatId)
                    if (chatData) {
                        connectAgentSocket(chatData.website_id, user.id)
                        joinedRef.current = true
                    }
                }
            }
        } catch (error) {
            console.error("Failed to load chat:", error)
        } finally {
            setChatLoading(false)
        }
    }

    const loadConversationDetails = async (chatId: number) => {
        try {
            const chatData = activeChats.find(c => c.id === chatId)
            if (chatData) {
                setConversation(chatData as any)
            }

            const [fetchedTags, fetchedNotes] = await Promise.all([
                getTags(chatId),
                getNotes(chatId)
            ])

            setTags(fetchedTags)
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
            await sendAgentMessage(selectedChat.toString(), messageContent)
        } catch (error) {
            console.error("Failed to send message:", error)
            setInput(messageContent)
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

    const handleAddTag = async (tagName: string) => {
        if (!selectedChat) return
        try {
            const newTag = await addTag(selectedChat, tagName)
            setTags(prev => [...prev, newTag])
        } catch (error) {
            console.error("Failed to add tag:", error)
        }
    }

    const handleRemoveTag = async (tagId: number) => {
        if (!selectedChat) return
        try {
            await deleteTag(selectedChat, tagId)
            setTags(prev => prev.filter(t => t.id !== tagId))
        } catch (error) {
            console.error("Failed to remove tag:", error)
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
                return chat.status === 'active' || chat.status === 'offline'
            case 'ai':
                return (chat.status === 'active' || chat.status === 'offline') && (chat as any).current_agent_id === null && !chat.is_handoff
            case 'new':
                return (chat.status === 'active' || chat.status === 'offline') && (chat.message_count || 0) <= 1
            case 'agent':
                return chat.status === 'closed' && (chat as any).current_agent_id !== null
            case 'ai-resolved':
                return chat.status === 'closed' && (chat as any).current_agent_id === null
            default:
                return chat.status === 'active' || chat.status === 'offline'
        }
    })

    const getFilterHeaderText = () => {
        switch (activeFilter) {
            case 'all':
                return 'All Chats'
            case 'ai':
                return 'AI Chats'
            case 'new':
                return 'New Chats'
            case 'agent':
                return 'Resolved by Agent'
            case 'ai-resolved':
                return 'Resolved by AI'
            default:
                return 'All Chats'
        }
    }

    const getFilterIcon = () => {
        switch (activeFilter) {
            case 'all':
                return <MessageSquare className="h-5 w-5" />
            case 'ai':
                return <Sparkles className="h-5 w-5" />
            case 'new':
                return <Inbox className="h-5 w-5" />
            case 'agent':
                return <Users className="h-5 w-5" />
            case 'ai-resolved':
                return <Bot className="h-5 w-5" />
            default:
                return <MessageSquare className="h-5 w-5" />
        }
    }

    return (
        <div className="flex h-full w-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            {/* COLUMN 1: Filter/Category Sidebar */}
            <div
                className={`bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-300 ease-in-out ${leftFilterCollapsed ? 'w-16' : 'w-64'
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
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'active' || c.status === 'offline').length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <MessageSquare className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">All</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'active' || c.status === 'offline').length}
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
                                        onClick={() => setActiveFilter('ai')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'ai'
                                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Sparkles className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => (c.status === 'active' || c.status === 'offline') && (c as any).current_agent_id === null && !c.is_handoff).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Sparkles className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">AI</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => (c.status === 'active' || c.status === 'offline') && (c as any).current_agent_id === null && !c.is_handoff).length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">AI</TooltipContent>}
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('new')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'new'
                                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Inbox className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => (c.status === 'active' || c.status === 'offline') && (c.message_count || 0) <= 1).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Inbox className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">New</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => (c.status === 'active' || c.status === 'offline') && (c.message_count || 0) <= 1).length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">New</TooltipContent>}
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
                                        onClick={() => setActiveFilter('agent')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'agent'
                                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Users className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">0</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Users className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">Agent</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">0</Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">Resolved by Agent</TooltipContent>}
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('ai-resolved')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'ai-resolved'
                                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Bot className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">0</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Bot className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">AI</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">0</Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">Resolved by AI</TooltipContent>}
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
                                            {(chat as any).current_agent_id && (
                                                <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-800" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-semibold text-gray-900 dark:text-white truncate">
                                                    {chat.session_id.substring(0, 8)}...
                                                </span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                    16h
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                                                Hi
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
                                {!leftFilterCollapsed && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-blue-600 dark:text-blue-400 dark:hover:bg-gray-700"
                                    >
                                        <TagIcon className="h-4 w-4 mr-1" />
                                        Tag conversation
                                    </Button>
                                )}

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

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="dark:text-gray-300">
                                            <MoreVertical className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onSelect={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}>
                                            {rightSidebarCollapsed ? "Show" : "Hide"} visitor details
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="text-red-600" onSelect={handleResolve}>
                                            Close conversation
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
                                    className="dark:text-gray-300"
                                    title={rightSidebarCollapsed ? "Show visitor details" : "Hide visitor details"}
                                >
                                    {rightSidebarCollapsed ? (
                                        <ChevronLeft className="h-4 w-4" />
                                    ) : (
                                        <PanelRightClose className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Tags Display */}
                        {tags.length > 0 && (
                            <div className="flex gap-2 mt-2 flex-wrap">
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
                                {messages.map((msg, index) => {
                                    const isSystem = (msg as any).message_type === 'system'
                                    const isAgent = (msg as any).sender_type === 'agent'
                                    const msgTimestamp = (msg as any).timestamp || msg.created_at
                                    const showTimestamp = index === 0 ||
                                        (new Date(msgTimestamp).getTime() - new Date((messages[index - 1] as any).timestamp || messages[index - 1].created_at).getTime() > 300000)

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

                                            {/* System Message */}
                                            {isSystem ? (
                                                <div className="flex justify-center">
                                                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-2 rounded-lg text-sm text-yellow-800 dark:text-yellow-200 max-w-md text-center">
                                                        {msg.content}
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
            {selectedChat && !rightSidebarCollapsed && conversation && (
                <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto flex-shrink-0 transition-all duration-300 ease-in-out">
                    <VisitorDetailsPanel
                        conversation={conversation}
                        tags={tags}
                        notes={notes.map(note => ({
                            ...note,
                            creator_name: note.creator_name || 'Unknown'
                        }))}
                        onAddTag={handleAddTag}
                        onRemoveTag={handleRemoveTag}
                        onAddNote={handleAddNote}
                        onDeleteNote={handleDeleteNote}
                    />
                </div>
            )}
        </div>
    )
}
