import { useEffect, useState, useRef, useLayoutEffect, useCallback } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useMessageStore } from '@/store/messages'
import { fetchActiveChats as fetchChatsApi } from '@/services/chats'
import { joinChat, closeConversation, takeoverConversation, markChatRead, fetchChatReadState } from '@/services/chats'
import { fetchChatMessages } from '@/services/messages'
import {
    connectAgentSocket,
    sendAgentMessage,
    addMessageHandler,
    sendAgentTyping,
} from '@/services/agentSocket'
import {
    addNote,
    getNotes,
    getBrowsingHistory,
    deleteNote,
    type Note
} from '@/services/conversationMetadata'
import { apiRequest } from '@/services/api'
import { updateConversationMetadata } from '@/services/conversationMetadata'
import { fetchChatSummary } from '@/services/chats'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
    Users,
    Bot
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import VisitorDetailsPanel from '@/components/VisitorDetailsPanel'
import UserAvatar from '@/components/UserAvatar'
import { formatDistanceToNow } from 'date-fns'
import { API_BASE } from '@/config/endpoints'

function getMessageTimestamp(m: any): number {
    const ts = m?.timestamp || m?.created_at
    const t = ts ? new Date(ts).getTime() : NaN
    return Number.isFinite(t) ? t : 0
}

function getMessageNumericId(m: any): number {
    const raw = m?.id
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    const n = Number(raw)
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

function compareMessagesChronologically(a: any, b: any): number {
    const aId = getMessageNumericId(a)
    const bId = getMessageNumericId(b)

    const aHasId = aId !== Number.MAX_SAFE_INTEGER
    const bHasId = bId !== Number.MAX_SAFE_INTEGER
    if (aHasId && bHasId && aId !== bId) return aId - bId

    const at = getMessageTimestamp(a)
    const bt = getMessageTimestamp(b)
    if (at !== bt) return at - bt

    return aId - bId
}

function formatShortAge(dateLike: any): string {
    const t = dateLike ? new Date(dateLike).getTime() : NaN
    if (!Number.isFinite(t)) return ''

    const deltaMs = Math.max(0, Date.now() - t)
    const minutes = Math.floor(deltaMs / 60000)
    if (minutes < 60) return `${minutes}m`

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`

    const days = Math.floor(hours / 24)
    return `${days}d`
}

function shortSessionId(sessionId: string | null | undefined): string {
    const raw = String(sessionId || '').trim()
    if (!raw) return ''
    const lastSegment = raw.split('-').filter(Boolean).pop() || raw
    if (lastSegment.length >= 12) return lastSegment.slice(-12)
    const compact = raw.replace(/-/g, '')
    return compact.length >= 12 ? compact.slice(-12) : raw
}

function getInitials(name: string | null | undefined, fallback: string): string {
    const v = String(name || '').trim()
    if (!v) return fallback
    const parts = v.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] || ''
    const second = (parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1]) || ''
    return (first + second).toUpperCase() || fallback
}

type PersonalShortcut = {
    id: number
    shortcut: string
    message: string
    is_active: boolean
}

type WebsiteShortcut = {
    id: number
    website_id: number
    shortcut: string
    message: string
    is_active: boolean
}

type ShortcutMatch = {
    scope: 'personal' | 'website'
    id: number
    shortcut: string
    message: string
}

function getVisitorAvatarSeed(visitorName: string | null | undefined, sessionId: string | null | undefined): string {
    const sid = String(sessionId || '').trim()
    if (sid) return sid
    const name = String(visitorName || '').trim()
    return name || 'visitor'
}

function getContrastTextColor(hexColor: unknown): 'black' | 'white' {
    const raw = String(hexColor || '').trim()
    if (!raw.startsWith('#')) return 'white'

    const hex = raw.slice(1)
    const normalized =
        hex.length === 3
            ? hex.split('').map((c) => c + c).join('')
            : hex.length === 6
                ? hex
                : ''

    if (!normalized) return 'white'
    const r = parseInt(normalized.slice(0, 2), 16)
    const g = parseInt(normalized.slice(2, 4), 16)
    const b = parseInt(normalized.slice(4, 6), 16)
    if (![r, g, b].every((n) => Number.isFinite(n))) return 'white'

    // Relative luminance (sRGB), quick approximation is good enough here.
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return luminance > 0.6 ? 'black' : 'white'
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
    visitor_avatar_color?: string | null
    created_at?: string
    last_message_at?: string
    status?: string
}

type FilterCategory = 'all' | 'mine' | 'unassigned' | 'resolved'

export default function ConversationsView() {
    const { sessionId, conversationId } = useParams<{ sessionId?: string; conversationId?: string }>()
    const navigate = useNavigate()
    const location = useLocation()
    const { user, setUser } = useAppStore()
    const { activeChats, setActiveChats } = useAppStore()
    const {
        chatEventsVersion,
        lastChatEvent,
        unreadByConversationId,
        incrementUnreadForConversation,
        setUnreadForConversation,
        clearUnreadForConversation,
        pruneUnreadByConversationIds,
        setUnreadMapFromServer,
        lastProcessedChatEventsVersion,
        setLastProcessedChatEventsVersion,
    } = useAppStore()
    const { messages, addMessage, addMessages, reconcileOptimisticMessage, reset } = useMessageStore()

    const activeChatsRef = useRef(activeChats)
    useEffect(() => {
        activeChatsRef.current = activeChats
    }, [activeChats])

    const [unreadRibbon, setUnreadRibbon] = useState<{ chatId: number; count: number } | null>(null)
    const unreadRibbonHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const autoMarkReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const unreadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const visitorTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const agentTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const agentTypingActiveRef = useRef(false)
    const lastTypingConversationIdRef = useRef<number | null>(null)

    const connectedWebsiteIdRef = useRef<number | null>(null)

    const [resolvedChats, setResolvedChats] = useState<any[]>([])
    const [resolvedLoading, setResolvedLoading] = useState(false)
    const [visitorTyping, setVisitorTyping] = useState(false)

    // Filter state
    const [activeFilter, setActiveFilter] = useState<FilterCategory>('all')
    const [leftFilterCollapsed, setLeftFilterCollapsed] = useState(() => {
        const saved = localStorage.getItem('chat_left_filter_collapsed')
        return saved ? saved === 'true' : true
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
    const hasLoadedChatsRef = useRef(false)
    const loadDetailsTokenRef = useRef(0)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const unreadDividerRef = useRef<HTMLDivElement>(null)
    const isAtBottomRef = useRef(true)
    const hasScrolledToUnreadRef = useRef(false)
    const readStateTokenRef = useRef(0)

    const composerRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [personalShortcuts, setPersonalShortcuts] = useState<PersonalShortcut[]>([])
    const [websiteShortcutsByWebsiteId, setWebsiteShortcutsByWebsiteId] = useState<Record<number, WebsiteShortcut[]>>({})
    const websiteShortcutsTokenRef = useRef(0)
    const [shortcutMenuOpen, setShortcutMenuOpen] = useState(false)
    const [shortcutMenuIndex, setShortcutMenuIndex] = useState(0)
    const [uploadingAttachment, setUploadingAttachment] = useState(false)

    const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<number | null>(null)

    // Takeover confirmation (Smartsupp-like)
    const [showTakeoverConfirm, setShowTakeoverConfirm] = useState(false)
    const [pendingSendMessage, setPendingSendMessage] = useState<string | null>(null)

    // Conversation details state
    const [conversation, setConversation] = useState<ConversationDetails | null>(null)
    const [notes, setNotes] = useState<Note[]>([])
    const [browsingHistory, setBrowsingHistory] = useState<any[]>([])
    const [availableTags, setAvailableTags] = useState<any[]>([])
    const [conversationTags, setConversationTags] = useState<any[]>([])
    const [tagToAddId, setTagToAddId] = useState<string>('')

    // Sidebar collapse state
    const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
        const saved = localStorage.getItem('chat_right_sidebar_collapsed')
        return saved ? saved === 'true' : true
    })

    // Persist collapse preferences
    useEffect(() => {
        localStorage.setItem('chat_left_filter_collapsed', String(leftFilterCollapsed))
    }, [leftFilterCollapsed])

    useEffect(() => {
        localStorage.setItem('chat_right_sidebar_collapsed', String(rightSidebarCollapsed))
    }, [rightSidebarCollapsed])

    // Load chats list (show spinner only on first load)
    useEffect(() => {
        fetchActiveChats({ showSpinner: true })
    }, [])

    // Load personal shortcuts (best-effort)
    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    const data = await apiRequest<PersonalShortcut[]>("/shortcuts?active_only=true")
                    if (!cancelled) setPersonalShortcuts(Array.isArray(data) ? data : [])
                } catch {
                    if (!cancelled) setPersonalShortcuts([])
                }
            })()
        return () => {
            cancelled = true
        }
    }, [])

    const insertAtCursor = (text: string) => {
        const el = composerRef.current
        if (!el) {
            setInput((prev) => prev + text)
            return
        }
        const start = el.selectionStart ?? input.length
        const end = el.selectionEnd ?? input.length
        const next = input.slice(0, start) + text + input.slice(end)
        setInput(next)
        requestAnimationFrame(() => {
            el.focus()
            const pos = start + text.length
            el.setSelectionRange(pos, pos)
        })
    }

    const wrapSelection = (left: string, right: string) => {
        const el = composerRef.current
        if (!el) return

        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? 0
        const hasSelection = end > start
        const selected = input.slice(start, end)
        const replacement = hasSelection ? `${left}${selected}${right}` : `${left}${right}`
        const next = input.slice(0, start) + replacement + input.slice(end)
        setInput(next)

        requestAnimationFrame(() => {
            el.focus()
            if (hasSelection) {
                el.setSelectionRange(start + left.length, start + left.length + selected.length)
            } else {
                el.setSelectionRange(start + left.length, start + left.length)
            }
        })
    }

    const getShortcutMatches = (value: string, websiteId: number | null) => {
        const v = value.trimStart()
        const m = v.match(/^[/.]([^\s]*)$/)
        if (!m) return { open: false, query: '', matches: [] as ShortcutMatch[] }

        const query = (m[1] || '').toLowerCase()
        const personalMatches: ShortcutMatch[] = personalShortcuts
            .filter((s) => s.is_active)
            .filter((s) => {
                const name = String(s.shortcut || '').toLowerCase()
                return query ? name.startsWith(query) : true
            })
            .map((s) => ({ scope: 'personal', id: s.id, shortcut: s.shortcut, message: s.message }))

        const websiteMatches: ShortcutMatch[] = (websiteId ? websiteShortcutsByWebsiteId[websiteId] : [])
            ?.filter((s) => s.is_active)
            .filter((s) => {
                const name = String(s.shortcut || '').toLowerCase()
                return query ? name.startsWith(query) : true
            })
            .map((s) => ({ scope: 'website', id: s.id, shortcut: s.shortcut, message: s.message }))

        const matches = [...personalMatches, ...websiteMatches].slice(0, 8)

        return { open: true, query, matches }
    }

    // Listen to global notification changes and refresh list (only on ConversationsView)
    const { unreadChatsCount } = useAppStore()
    const lastCountRef = useRef(unreadChatsCount)

    useEffect(() => {
        // Only refresh if count actually increased (new chat arrived)
        if (unreadChatsCount > lastCountRef.current) {
            console.log('📨 New chats detected, refreshing chat list...')
            fetchActiveChats({ showSpinner: false })
        }
        lastCountRef.current = unreadChatsCount
    }, [unreadChatsCount])

    const selectedWebsiteId = selectedChat
        ? ((conversation as any)?.website_id ?? activeChats.find((c) => c.id === selectedChat)?.website_id ?? null)
        : null

    useEffect(() => {
        if (!selectedWebsiteId) return

        const token = ++websiteShortcutsTokenRef.current
            ; (async () => {
                try {
                    const data = await apiRequest<WebsiteShortcut[]>(`/websites/${selectedWebsiteId}/shortcuts?active_only=true`)
                    if (token !== websiteShortcutsTokenRef.current) return
                    setWebsiteShortcutsByWebsiteId((prev) => ({
                        ...prev,
                        [selectedWebsiteId]: Array.isArray(data) ? data : [],
                    }))
                } catch {
                    if (token !== websiteShortcutsTokenRef.current) return
                    setWebsiteShortcutsByWebsiteId((prev) => ({
                        ...prev,
                        [selectedWebsiteId]: [],
                    }))
                }
            })()
    }, [selectedWebsiteId])

    const clearUnreadForChat = useCallback((chatId: number) => {
        clearUnreadForConversation(chatId)
    }, [clearUnreadForConversation])

    const stopAgentTyping = useCallback((conversationId?: number | null) => {
        const id = conversationId ?? lastTypingConversationIdRef.current
        if (!id) return
        if (agentTypingActiveRef.current) {
            agentTypingActiveRef.current = false
            sendAgentTyping(String(id), false)
        }
        if (agentTypingTimerRef.current) {
            clearTimeout(agentTypingTimerRef.current)
            agentTypingTimerRef.current = null
        }
    }, [])

    const scheduleAgentTyping = useCallback((value: string) => {
        if (!selectedChat) return

        const hasText = Boolean(value.trim())
        lastTypingConversationIdRef.current = selectedChat

        if (hasText && !agentTypingActiveRef.current) {
            agentTypingActiveRef.current = true
            sendAgentTyping(String(selectedChat), true)
        }

        if (!hasText) {
            stopAgentTyping(selectedChat)
            return
        }

        if (agentTypingTimerRef.current) {
            clearTimeout(agentTypingTimerRef.current)
        }

        agentTypingTimerRef.current = setTimeout(() => {
            agentTypingTimerRef.current = null
            stopAgentTyping(selectedChat)
        }, 1600)
    }, [selectedChat, stopAgentTyping])

    const showUnreadRibbonForChat = useCallback((chatId: number, count: number) => {
        if (unreadRibbonHideTimerRef.current) {
            clearTimeout(unreadRibbonHideTimerRef.current)
            unreadRibbonHideTimerRef.current = null
        }

        if (count > 0) {
            setUnreadRibbon({ chatId, count })
            unreadRibbonHideTimerRef.current = setTimeout(() => {
                setUnreadRibbon(null)
                unreadRibbonHideTimerRef.current = null
            }, 3000)
        } else {
            setUnreadRibbon(null)
        }
    }, [])

    const openChat = useCallback((chatId: number) => {
        const count = unreadByConversationId[chatId] || 0
        showUnreadRibbonForChat(chatId, count)

        // Clear the list badge immediately (local-only). Server read state is updated
        // only when the agent actually scrolls to the bottom.
        setUnreadForConversation(chatId, 0)

        setSelectedChat(chatId)

        // Reset scroll intent for this chat.
        isAtBottomRef.current = true
        hasScrolledToUnreadRef.current = false
    }, [showUnreadRibbonForChat, unreadByConversationId, setUnreadForConversation])

    // Refresh list/messages when global chat events arrive.
    // This is a safety net: if the per-website WS misses an event, we still
    // re-fetch persisted data so timestamps reflect DB truth.
    useEffect(() => {
        // Critical: avoid replaying stale lastChatEvent when navigating away/back.
        if (chatEventsVersion <= lastProcessedChatEventsVersion) return

        if (!lastChatEvent) return

        const eventType = lastChatEvent.type
        const eventConversationId = lastChatEvent.conversation_id

        const conversationIsInList =
            typeof eventConversationId === 'number' &&
            activeChatsRef.current.some((c) => c.id === eventConversationId)

        if (
            eventType === 'new_chat' ||
            eventType === 'conversation_assigned' ||
            eventType === 'conversation_closed' ||
            eventType === 'visitor_closed_chat' ||
            (eventType === 'visitor_message' && conversationIsInList)
        ) {
            fetchActiveChats({ showSpinner: false })
        }

        if (eventType === 'visitor_message' && selectedChat && eventConversationId === selectedChat) {
            console.log('🔄 Global visitor_message: refreshing messages from server...')
            loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
        }

        if (eventType === 'visitor_closed_chat' && selectedChat && eventConversationId === selectedChat) {
            loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
        }

        // Unread badge fallback via global notifications.
        if (eventType === 'conversation_unread' && typeof eventConversationId === 'number' && eventConversationId > 0) {
            if (!selectedChat || eventConversationId !== selectedChat) {
                incrementUnreadForConversation(eventConversationId)
            }
        }
        // Mark this version as processed so remounts don't re-apply it.
        setLastProcessedChatEventsVersion(chatEventsVersion)
    }, [
        chatEventsVersion,
        lastProcessedChatEventsVersion,
        lastChatEvent,
        selectedChat,
        selectedWebsiteId,
        incrementUnreadForConversation,
        setLastProcessedChatEventsVersion,
    ])

    const getChatById = useCallback((chatId: number) => {
        const fromActive = activeChats.find((c) => c.id === chatId)
        if (fromActive) return fromActive
        const fromResolved = resolvedChats.find((c: any) => c.id === chatId)
        return fromResolved || null
    }, [activeChats, resolvedChats])

    const isResolvedSelected = Boolean(conversation && (conversation as any).status === 'resolved')

    const isChatsListRoute = (() => {
        const p = String(location?.pathname || '')
        return p === '/dashboard/chats' || p === '/dashboard/chats/'
    })()

    const getPreferredConversationId = useCallback((): number | null => {
        // If we're on the list route (/dashboard/chats), never auto-select a chat
        // from location.state; the user explicitly navigated back to the list.
        if (isChatsListRoute) return null
        const fromState = Number((location as any)?.state?.conversationId)
        if (Number.isFinite(fromState) && fromState > 0) return fromState
        const fromParam = Number(conversationId)
        if (Number.isFinite(fromParam) && fromParam > 0) return fromParam
        return null
    }, [isChatsListRoute, location, conversationId])

    // When navigating back to the chats list (/dashboard/chats), clear any previously
    // selected chat so the empty-state screen renders (instead of persisting the thread view).
    useEffect(() => {
        if (!isChatsListRoute) return
        if (selectedChat === null) return
        setSelectedChat(null)
        setConversation(null)
        setInput('')
        setVisitorTyping(false)
        setFirstUnreadMessageId(null)
        setShowTakeoverConfirm(false)
        setPendingSendMessage(null)
        reset()
        stopAgentTyping(null)
    }, [isChatsListRoute, selectedChat, reset, stopAgentTyping])

    // Ensure conversation details populate once chats load (handles refresh on deep links)
    useEffect(() => {
        if (selectedChat) {
            const chatData = getChatById(selectedChat)
            if (chatData) {
                setConversation(chatData as any)
            }
        }
    }, [selectedChat, getChatById])

    // Handle conversation selection from URL.
    // Canonical URL is /dashboard/chats/:sessionId.
    // We still accept a conversationId via navigation state for exact selection.
    useEffect(() => {
        const preferredId = getPreferredConversationId()
        if (preferredId) {
            if (preferredId !== selectedChat) {
                openChat(preferredId)
            }
            return
        }

        if (!sessionId) return

        const matched = activeChats.find((c) => c.session_id === sessionId)
            || resolvedChats.find((c: any) => c.session_id === sessionId)
        if (matched && matched.id !== selectedChat) {
            openChat(matched.id)
        }
    }, [getPreferredConversationId, sessionId, activeChats, resolvedChats, selectedChat, openChat])

    // Legacy deep-link support: /dashboard/chats/conversation/:conversationId -> redirect to sessionId URL.
    useEffect(() => {
        const cid = Number(conversationId)
        if (!Number.isFinite(cid) || cid <= 0) return

        let cancelled = false
            ; (async () => {
                try {
                    const summary = await fetchChatSummary(cid)
                    const sid = String((summary as any)?.session_id || '').trim()
                    if (!sid) return
                    if (!cancelled) {
                        navigate(`/dashboard/chats/${encodeURIComponent(sid)}`, {
                            replace: true,
                            state: { conversationId: cid },
                        })
                    }
                } catch {
                    // ignore
                }
            })()

        return () => {
            cancelled = true
        }
    }, [conversationId, navigate])

    // Load chat when selected
    useEffect(() => {
        if (selectedChat) {
            const chatData = getChatById(selectedChat)
            const selectedSessionId = chatData?.session_id
            if (selectedSessionId && selectedSessionId !== sessionId) {
                navigate(`/dashboard/chats/${encodeURIComponent(String(selectedSessionId))}`)
            }
        }

        if (selectedChat) {
            setFirstUnreadMessageId(null)
            hasScrolledToUnreadRef.current = false
            isAtBottomRef.current = true
            setVisitorTyping(false)
            loadChatData(selectedChat)
            loadConversationDetails(selectedChat)
        }

        return () => {
            if (selectedChat) {
                connectedWebsiteIdRef.current = null
                joinedRef.current = false
            }

            if (autoMarkReadTimerRef.current) {
                clearTimeout(autoMarkReadTimerRef.current)
                autoMarkReadTimerRef.current = null
            }
        }
    }, [selectedChat])

    // Ensure resolved conversations open in the resolved filter.
    useEffect(() => {
        if (!selectedChat) return

        let cancelled = false
            ; (async () => {
                try {
                    const summary = await fetchChatSummary(selectedChat)
                    if (cancelled) return
                    if (String((summary as any)?.status || '') === 'resolved') {
                        setActiveFilter('resolved')
                    }
                } catch {
                    // ignore
                }
            })()

        return () => {
            cancelled = true
        }
    }, [selectedChat])

    // Setup WebSocket message handler for current chat
    useEffect(() => {
        if (!selectedChat || !user?.id) return

        // Single global agent socket (website_id=0). Server broadcasts website-scoped
        // events to global sockets, and we filter by conversation_id in handlers.
        connectAgentSocket(0, user.id)
        connectedWebsiteIdRef.current = null

        // Register message handler
        const removeHandler = addMessageHandler((data) => {
            console.log('📩 WebSocket message received:', data)

            const dataConversationId = Number((data as any)?.conversation_id)

            // Visitor message: either add to current chat UI, or increment unread badge.
            if (data.type === 'visitor_message' && dataConversationId === selectedChat) {
                setVisitorTyping(false)
                if (visitorTypingTimerRef.current) {
                    clearTimeout(visitorTypingTimerRef.current)
                    visitorTypingTimerRef.current = null
                }
                // Visitor sent a message - add to UI
                const dto = (data as any)?.message_obj
                if (dto && typeof dto === 'object') {
                    console.log('👤 Adding visitor message DTO to UI')
                    addMessage(dto)

                    // Keep list preview + timestamp in sync (WhatsApp-like).
                    const content = String((dto as any)?.content ?? '').trim()
                    const ts = (dto as any)?.timestamp || (dto as any)?.created_at || new Date().toISOString()
                    if (content) {
                        const latest = activeChatsRef.current
                        const idx = latest.findIndex(c => c.id === dataConversationId)
                        if (idx >= 0) {
                            const next = [...latest]
                            next[idx] = { ...next[idx], last_message: content, last_message_at: ts }
                            setActiveChats(next)
                        }
                    }
                } else {
                    console.warn('👤 Missing visitor message DTO; refreshing thread')
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }

                // If the agent isn't pinned to the bottom, treat it as unread for UX.
                if (!isAtBottomRef.current) {
                    const dtoId = dto && typeof dto === 'object' ? Number((dto as any).id) : NaN
                    if (!firstUnreadMessageId && Number.isFinite(dtoId) && dtoId > 0) {
                        setFirstUnreadMessageId(dtoId)
                    }
                    incrementUnreadForConversation(selectedChat, 1)
                } else if (!firstUnreadMessageId) {
                    // Agent is actively viewing latest messages: keep server truth in sync.
                    markChatRead(selectedChat).then(() => {
                        setUnreadForConversation(selectedChat, 0)
                    }).catch(() => { })
                }
            } else if (data.type === 'visitor_message' && dataConversationId && dataConversationId !== selectedChat) {
                const dto = (data as any)?.message_obj
                const content = (dto && typeof dto === 'object' ? (dto as any)?.content : null) ?? (data as any)?.message
                const ts = (dto && typeof dto === 'object'
                    ? ((dto as any)?.timestamp || (dto as any)?.created_at)
                    : null) || new Date().toISOString()

                // Best-effort: update preview without a full refresh.
                if (typeof content === 'string' && content.trim()) {
                    const latest = activeChatsRef.current
                    const idx = latest.findIndex(c => c.id === dataConversationId)
                    if (idx >= 0) {
                        const next = [...latest]
                        next[idx] = { ...next[idx], last_message: content, last_message_at: ts }
                        setActiveChats(next)
                    }
                }
            } else if (data.type === 'conversation_unread' && dataConversationId) {
                const unreadCountRaw = (data as any)?.unread_count
                const deltaRaw = (data as any)?.delta

                // If the agent is viewing this chat, don't badge it.
                if (selectedChat && dataConversationId === selectedChat) {
                    return
                }

                if (typeof unreadCountRaw === 'number' && Number.isFinite(unreadCountRaw)) {
                    setUnreadForConversation(dataConversationId, unreadCountRaw)
                } else {
                    const delta = typeof deltaRaw === 'number' && Number.isFinite(deltaRaw) ? deltaRaw : 1
                    incrementUnreadForConversation(dataConversationId, delta)
                }

                scheduleUnreadRefresh()
            } else if (data.type === 'message_sent' && dataConversationId === selectedChat) {
                stopAgentTyping(selectedChat)

                // If the backend auto-enabled availability, reflect it immediately in UI.
                const availabilityChanged = Boolean((data as any)?.availability_changed)
                const agentIsAvailable = (data as any)?.agent_is_available
                if (availabilityChanged && agentIsAvailable === true) {
                    const current = useAppStore.getState().user
                    if (current && current.is_available === false) {
                        setUser({ ...current, is_available: true })
                    }
                }

                // Our message was confirmed - add to UI
                const dto = (data as any)?.message_obj
                if (dto && typeof dto === 'object') {
                    console.log('✅ Agent message confirmed (DTO)')
                    const clientId = String((data as any)?.client_message_id || '').trim()
                    if (clientId) {
                        reconcileOptimisticMessage(`tmp:${clientId}`, dto)
                    } else {
                        addMessage(dto)
                    }

                    // Keep list preview + timestamp in sync.
                    const content = String((dto as any)?.content ?? '').trim()
                    const ts = (dto as any)?.timestamp || (dto as any)?.created_at || new Date().toISOString()
                    if (content) {
                        const latest = activeChatsRef.current
                        const idx = latest.findIndex(c => c.id === dataConversationId)
                        if (idx >= 0) {
                            const next = [...latest]
                            next[idx] = { ...next[idx], last_message: content, last_message_at: ts }
                            setActiveChats(next)
                        }
                    }
                } else {
                    console.warn('✅ Missing agent message DTO; refreshing thread')
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'visitor_closed_chat' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
                if (selectedChat && dataConversationId === selectedChat) {
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'visitor_left_website' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
                if (selectedChat && dataConversationId === selectedChat) {
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'visitor_socket_connected' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
                if (selectedChat && dataConversationId === selectedChat) {
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'conversation_assigned') {
                // Another agent (or us) claimed a conversation.
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'conversation_closed') {
                fetchActiveChats({ showSpinner: false })
                if (selectedChat && dataConversationId === selectedChat) {
                    setSelectedChat(null)
                    navigate('/dashboard/chats')
                }
            } else if (data.type === 'new_conversation') {
                // New conversation arrived - refresh chat list
                console.log('📨 New conversation arrived, refreshing...')
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'connected') {
                // Socket reconnected; refresh list and current thread for consistency.
                fetchActiveChats({ showSpinner: false })
                if (selectedChat) {
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'visitor_typing' && dataConversationId === selectedChat) {
                const isTyping = Boolean((data as any)?.is_typing)
                if (isTyping) {
                    setVisitorTyping(true)
                    if (visitorTypingTimerRef.current) {
                        clearTimeout(visitorTypingTimerRef.current)
                    }
                    visitorTypingTimerRef.current = setTimeout(() => {
                        visitorTypingTimerRef.current = null
                        setVisitorTyping(false)
                    }, 3000)
                } else {
                    setVisitorTyping(false)
                    if (visitorTypingTimerRef.current) {
                        clearTimeout(visitorTypingTimerRef.current)
                        visitorTypingTimerRef.current = null
                    }
                }
            } else if (data.type === 'page_view' && dataConversationId === selectedChat) {
                // Realtime browsing update: re-fetch history (capped)
                getBrowsingHistory(selectedChat)
                    .then((hist) => setBrowsingHistory(Array.isArray(hist) ? hist : []))
                    .catch(() => { })
            }
        })

        // Cleanup: remove handler when chat changes or component unmounts
        return removeHandler
    }, [selectedChat, user?.id, (conversation as any)?.website_id, firstUnreadMessageId, incrementUnreadForConversation, setUnreadForConversation, stopAgentTyping])

    useEffect(() => {
        return () => {
            stopAgentTyping()
        }
    }, [selectedChat, stopAgentTyping])

    // Scroll behavior:
    // - If there are unread messages, jump to the unread divider once.
    // - Otherwise, stick to bottom only if the user is already at bottom.
    useLayoutEffect(() => {
        if (!selectedChat || messages.length === 0) return

        const doScroll = () => {
            if (firstUnreadMessageId && unreadDividerRef.current && !hasScrolledToUnreadRef.current) {
                hasScrolledToUnreadRef.current = true
                unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' })
                return
            }

            if (isAtBottomRef.current) {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
            }
        }

        // Initial jump
        doScroll()

        // Some browsers or layout shifts (images) might need a tiny delay
        const timer = setTimeout(doScroll, 100)
        return () => clearTimeout(timer)
    }, [messages, selectedChat, firstUnreadMessageId])

    const fetchActiveChats = async ({ showSpinner }: { showSpinner: boolean }) => {
        if (showSpinner) {
            setLoading(true)
        }
        try {
            const chats = await fetchChatsApi()
            setActiveChats(chats)
            hasLoadedChatsRef.current = true

            // Hydrate per-conversation unread counts from server truth.
            const unreadMap: Record<number, number> = {}
            for (const chat of chats as any[]) {
                const id = Number((chat as any)?.id)
                const count = Number((chat as any)?.unread_count)
                if (Number.isFinite(id) && id > 0 && Number.isFinite(count)) {
                    unreadMap[id] = Math.max(0, count)
                }
            }
            setUnreadMapFromServer(unreadMap)

            pruneUnreadByConversationIds(chats.map(c => c.id))
        } catch (error) {
            console.error("Failed to fetch chats:", error)
        } finally {
            if (showSpinner) {
                setLoading(false)
            }
        }
    }

    const scheduleUnreadRefresh = useCallback(() => {
        if (unreadRefreshTimerRef.current) {
            clearTimeout(unreadRefreshTimerRef.current)
            unreadRefreshTimerRef.current = null
        }

        unreadRefreshTimerRef.current = setTimeout(() => {
            unreadRefreshTimerRef.current = null
            fetchActiveChats({ showSpinner: false })
        }, 300)
    }, [])

    const loadChatData = async (
        chatId: number,
        {
            showSpinner = true,
            preserveMessages = false,
        }: { showSpinner?: boolean; preserveMessages?: boolean } = {}
    ) => {
        const token = ++loadMessagesTokenRef.current
        if (showSpinner) {
            setChatLoading(true)
        }
        if (!preserveMessages) {
            reset()
        }

        try {
            const chatMessages = await fetchChatMessages(chatId.toString())

            // If the user switched chats while we were loading, ignore stale results.
            if (loadMessagesTokenRef.current !== token) {
                return
            }
            if (preserveMessages) {
                // Replace existing thread with server truth, without showing a loader.
                // Use store's de-dupe logic then sort by timestamp.
                reset()
            }
            addMessages(chatMessages)

            // Fetch read-state after messages load so we can place an unread separator.
            const readToken = ++readStateTokenRef.current
            try {
                const state = await fetchChatReadState(chatId)
                if (readStateTokenRef.current === readToken && selectedChat === chatId) {
                    const boundary = state.first_unread_message_id ?? null
                    setFirstUnreadMessageId(boundary)
                    if (!boundary) {
                        setUnreadForConversation(chatId, 0)
                        setUnreadRibbon(null)
                        if (autoMarkReadTimerRef.current) {
                            clearTimeout(autoMarkReadTimerRef.current)
                            autoMarkReadTimerRef.current = null
                        }
                    } else {
                        if (autoMarkReadTimerRef.current) {
                            clearTimeout(autoMarkReadTimerRef.current)
                            autoMarkReadTimerRef.current = null
                        }

                        autoMarkReadTimerRef.current = setTimeout(() => {
                            autoMarkReadTimerRef.current = null
                            // Only clear if the agent is still viewing this chat.
                            if (selectedChat !== chatId) return

                            markChatRead(chatId)
                                .then(() => {
                                    setFirstUnreadMessageId(null)
                                    setUnreadForConversation(chatId, 0)
                                    setUnreadRibbon(null)
                                    scheduleUnreadRefresh()
                                })
                                .catch(() => { })
                        }, 5000)
                    }
                }
            } catch {
                // Best-effort: separator is optional.
            }

            // Do NOT auto-join on selection.
            // Joining happens only when the agent actually starts responding (send action).
            const chatData = getChatById(chatId)
            joinedRef.current = chatData?.assigned_agent_id === user?.id
        } catch (error) {
            console.error("Failed to load chat:", error)
        } finally {
            if (showSpinner && loadMessagesTokenRef.current === token) {
                setChatLoading(false)
            }
        }
    }

    const handleMessagesScroll = useCallback(() => {
        const el = messagesContainerRef.current
        if (!el) return

        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        isAtBottomRef.current = nearBottom

        if (nearBottom && selectedChat && firstUnreadMessageId) {
            markChatRead(selectedChat)
                .then(() => {
                    setFirstUnreadMessageId(null)
                    setUnreadForConversation(selectedChat, 0)
                })
                .catch(() => { })
        }
    }, [firstUnreadMessageId, selectedChat, setUnreadForConversation])

    const loadConversationDetails = async (chatId: number) => {
        const token = ++loadDetailsTokenRef.current
        try {
            const chatData = activeChats.find(c => c.id === chatId)
            if (chatData) {
                setConversation(chatData as any)
                setConversationTags((chatData as any).tags || [])

                // Tags are global (not website-scoped)
                apiRequest<any[]>(`/tags`).then(tags => {
                    if (loadDetailsTokenRef.current === token) {
                        setAvailableTags(Array.isArray(tags) ? tags : [])
                    }
                }).catch(() => {
                    if (loadDetailsTokenRef.current === token) {
                        setAvailableTags([])
                    }
                })
            } else {
                try {
                    const summary = await fetchChatSummary(chatId)
                    if (loadDetailsTokenRef.current === token) {
                        setConversation(summary as any)
                        setConversationTags(((summary as any).tags || []) as any)
                    }

                    apiRequest<any[]>(`/tags`).then(tags => {
                        if (loadDetailsTokenRef.current === token) {
                            setAvailableTags(Array.isArray(tags) ? tags : [])
                        }
                    }).catch(() => {
                        if (loadDetailsTokenRef.current === token) {
                            setAvailableTags([])
                        }
                    })
                } catch {
                    // ignore
                }
            }

            const fetchedNotes = await getNotes(chatId)

            let fetchedHistory: any[] = []
            try {
                fetchedHistory = await getBrowsingHistory(chatId)
            } catch {
                fetchedHistory = []
            }

            if (loadDetailsTokenRef.current !== token) {
                return
            }
            setNotes(fetchedNotes)
            setBrowsingHistory(Array.isArray(fetchedHistory) ? fetchedHistory : [])
        } catch (error) {
            console.error("Failed to load conversation details:", error)
        }
    }

    const handleChatSelect = (chatId: number) => {
        openChat(chatId)
    }

    const handleAddTag = async (tagId: number) => {
        if (!selectedChat) return
        try {
            await apiRequest(`/conversations/${selectedChat}/tags`, {
                method: 'POST',
                body: JSON.stringify({ tag_id: tagId })
            })
            // Update local state
            const tag = availableTags.find(t => t.id === tagId)
            if (tag) {
                setConversationTags(prev => [...prev.filter(t => t.id !== tagId), tag])
            }
            // Also update in activeChats list to keep it in sync
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat
                    ? { ...c, tags: [...((c as any).tags || []).filter((t: any) => t.id !== tagId), tag] }
                    : c
            ))
            setTagToAddId('')
        } catch (error) {
            console.error("Failed to add tag:", error)
        }
    }

    const handleRemoveTag = async (tagId: number) => {
        if (!selectedChat) return
        try {
            await apiRequest(`/conversations/${selectedChat}/tags/${tagId}`, {
                method: 'DELETE'
            })
            // Update local state
            setConversationTags(prev => prev.filter(t => t.id !== tagId))
            // Also update in activeChats list
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat
                    ? { ...c, tags: ((c as any).tags || []).filter((t: any) => t.id !== tagId) }
                    : c
            ))
        } catch (error) {
            console.error("Failed to remove tag:", error)
        }
    }

    const handleSendMessage = async () => {
        if (!input.trim() || !selectedChat) return
        if (isResolvedSelected) return

        const messageContent = input.trim()
        setInput('')
        stopAgentTyping(selectedChat)

        try {
            const chatData = getChatById(selectedChat)
            const alreadyJoinedByMe = chatData?.assigned_agent_id === user?.id

            if (!joinedRef.current && !alreadyJoinedByMe) {
                try {
                    const joinResult: any = await joinChat(selectedChat.toString())
                    joinedRef.current = true

                    if (joinResult?.availability_changed && joinResult?.agent_is_available === true) {
                        const current = useAppStore.getState().user
                        if (current && current.is_available === false) {
                            setUser({ ...current, is_available: true })
                        }
                    }

                    // Prefer server-truth join message (stable timestamp/id).
                    if (joinResult?.message_obj) {
                        addMessage(joinResult.message_obj)
                    } else {
                        // Fallback: refresh thread so join event is represented correctly.
                        loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                    }
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

            const clientId = sendAgentMessage(messageContent, selectedChat.toString())

            // Optimistic UI: show agent bubble immediately, then reconcile when
            // message_sent arrives with canonical id/timestamp.
            const optimisticCreatedAt = new Date().toISOString()
            addMessage({
                id: `tmp:${clientId}`,
                conversation_id: selectedChat,
                sender_type: 'agent',
                actor: 'agent',
                kind: 'chat',
                content: messageContent,
                created_at: optimisticCreatedAt,
                sender_name: user?.name || undefined,
                sender_avatar_url: (user as any)?.avatar_url || undefined,
            } as any)

            // Best-effort: update preview immediately.
            try {
                const latest = activeChatsRef.current
                const idx = latest.findIndex(c => c.id === selectedChat)
                if (idx >= 0) {
                    const next = [...latest]
                    next[idx] = { ...next[idx], last_message: messageContent, last_message_at: optimisticCreatedAt }
                    setActiveChats(next)
                }
            } catch {
                // ignore
            }
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
        if (isResolvedSelected) return

        try {
            const takeoverResult: any = await takeoverConversation(selectedChat)
            joinedRef.current = true

            if (takeoverResult?.availability_changed && takeoverResult?.agent_is_available === true) {
                const current = useAppStore.getState().user
                if (current && current.is_available === false) {
                    setUser({ ...current, is_available: true })
                }
            }

            if (takeoverResult?.message_obj) {
                addMessage(takeoverResult.message_obj)
            } else {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            }

            stopAgentTyping(selectedChat)
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
            await fetchActiveChats({ showSpinner: false })
            // If user is viewing resolved, refresh that list too.
            if (activeFilter === 'resolved') {
                try {
                    const { fetchClosedConversations } = await import('@/services/chats')
                    const data = await fetchClosedConversations(undefined, undefined, 100)
                    setResolvedChats(data as any)
                } catch (e) {
                    console.error('Failed to refresh resolved conversations:', e)
                }
            }
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

    const chatsForList = activeFilter === 'resolved'
        ? (Array.isArray(resolvedChats) ? resolvedChats : [])
        : activeChats

    const filteredChats = chatsForList.filter(chat => {
        // Apply search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase().trim()
            const matchesSession = chat.session_id.toLowerCase().includes(q)
            const matchesName = String((chat as any).visitor_name || '').toLowerCase().includes(q)
            if (!matchesSession && !matchesName) {
                return false
            }
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

    useEffect(() => {
        if (activeFilter !== 'resolved') return

        let cancelled = false
        const load = async () => {
            try {
                setResolvedLoading(true)
                const { fetchClosedConversations } = await import('@/services/chats')
                const data = await fetchClosedConversations(undefined, undefined, 100)
                if (!cancelled) setResolvedChats(Array.isArray(data) ? (data as any) : [])
            } catch (e) {
                console.error('Failed to load resolved conversations:', e)
                if (!cancelled) setResolvedChats([])
            } finally {
                if (!cancelled) setResolvedLoading(false)
            }
        }
        load()

        return () => {
            cancelled = true
        }
    }, [activeFilter])

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
                                                <span className="text-xs font-semibold">{resolvedChats.length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Check className="h-5 w-5 flex-shrink-0" />
                                                    <span className="flex-1 text-left">Resolved</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {resolvedChats.length}
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
                    {(activeFilter === 'resolved' ? resolvedLoading : loading) ? (
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
                                        <UserAvatar
                                            seed={getVisitorAvatarSeed((chat as any).visitor_name, chat.session_id)}
                                            bgColor={(chat as any).visitor_avatar_color}
                                            className="w-10 h-10 flex-shrink-0"
                                            iconClassName="w-10 h-10"
                                            title={(chat as any).visitor_name || shortSessionId(chat.session_id)}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-gray-900 dark:text-white truncate">
                                                    {(chat as any).visitor_name || shortSessionId(chat.session_id)}
                                                </span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                                                    {((chat as any).last_message_at || (chat as any).created_at)
                                                        ? formatShortAge((chat as any).last_message_at || (chat as any).created_at)
                                                        : ''}
                                                </span>
                                            </div>

                                            <div className="mt-1 flex items-center justify-between gap-2">
                                                <Badge variant="secondary" className="h-5 px-2 text-[10px] max-w-44 truncate">
                                                    {(chat as any).website_name
                                                        ? (chat as any).website_name
                                                        : `Website #${(chat as any).website_id}`}
                                                </Badge>
                                                {chat.id !== selectedChat && Boolean(unreadByConversationId[chat.id]) && (
                                                    <Badge
                                                        variant="destructive"
                                                        className="h-5 min-w-5 justify-center rounded-full px-1.5 text-xs flex-shrink-0"
                                                    >
                                                        {unreadByConversationId[chat.id] > 99 ? '99+' : unreadByConversationId[chat.id]}
                                                    </Badge>
                                                )}
                                            </div>
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
                                <UserAvatar
                                    seed={getVisitorAvatarSeed(conversation?.visitor_name, conversation?.session_id)}
                                    bgColor={conversation?.visitor_avatar_color}
                                    className="w-10 h-10 flex-shrink-0"
                                    iconClassName="w-10 h-10"
                                    title={conversation?.visitor_name || shortSessionId(conversation?.session_id)}
                                />
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                                        {conversation?.visitor_name || shortSessionId(conversation?.session_id)}
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
                                {!isResolvedSelected && (
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
                                )}
                            </div>
                        </div>

                        {/* Tags Row (below header) */}
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                {conversationTags.length === 0 ? (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">No tags</span>
                                ) : (
                                    conversationTags
                                        .slice()
                                        .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))
                                        .map((t: any) => (
                                            <Badge
                                                key={t.id}
                                                variant="secondary"
                                                className="gap-1 border border-transparent"
                                                style={{
                                                    backgroundColor: String(t?.color || ''),
                                                    color: getContrastTextColor(t?.color),
                                                }}
                                            >
                                                <span className="truncate max-w-40">{t.name}</span>
                                                <button
                                                    type="button"
                                                    className="ml-1 opacity-80 hover:opacity-100"
                                                    onClick={() => handleRemoveTag(Number(t.id))}
                                                    aria-label={`Remove tag ${String(t.name || '')}`}
                                                    title="Remove"
                                                >
                                                    ×
                                                </button>
                                            </Badge>
                                        ))
                                )}
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                                <select
                                    value={tagToAddId}
                                    onChange={(e) => setTagToAddId(e.target.value)}
                                    className="h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-white"
                                >
                                    <option value="">Add tag…</option>
                                    {availableTags
                                        .filter((t: any) => !conversationTags.some((ct: any) => ct?.id === t?.id))
                                        .slice()
                                        .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))
                                        .map((t: any) => (
                                            <option key={t.id} value={String(t.id)}>
                                                {String(t.name || '')}
                                            </option>
                                        ))}
                                </select>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        const id = Number(tagToAddId)
                                        if (!Number.isFinite(id) || id <= 0) return
                                        handleAddTag(id)
                                    }}
                                    disabled={!tagToAddId}
                                >
                                    Add
                                </Button>
                            </div>
                        </div>

                    </div>

                    {/* Messages Area */}
                    <div
                        ref={messagesContainerRef}
                        onScroll={handleMessagesScroll}
                        className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900"
                    >
                        {unreadRibbon && unreadRibbon.chatId === selectedChat && unreadRibbon.count > 0 && !firstUnreadMessageId && (
                            <div className="flex justify-center">
                                <div className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300">
                                    {unreadRibbon.count} unread message{unreadRibbon.count === 1 ? '' : 's'}
                                </div>
                            </div>
                        )}
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
                                    .sort(compareMessagesChronologically)
                                    .map((msg, index, sortedMessages) => {
                                        const senderType = (msg as any).sender_type || (msg as any).sender || 'system'
                                        const actor = (msg as any).actor || senderType
                                        const kind = (msg as any).kind || (actor === 'system' ? 'event' : 'chat')
                                        const eventType = (msg as any).event_type || null
                                        const isSystemEvent = actor === 'system' && kind === 'event'
                                        const isJoin = isSystemEvent && eventType === 'agent_join'
                                        const isBot = actor === 'bot'
                                            || (actor === 'system' && kind === 'chat')
                                            || (senderType === 'system' && (eventType === 'bot' || (eventType && eventType.startsWith('automation'))))
                                        const isAgent = actor === 'agent' || senderType === 'agent'
                                        const msgTimestamp = (msg as any).timestamp || msg.created_at
                                        const showTimestamp = index === 0 ||
                                            (new Date(msgTimestamp).getTime() - new Date((sortedMessages[index - 1] as any).timestamp || (sortedMessages[index - 1] as any).created_at).getTime() > 300000)

                                        const numericMsgId = Number((msg as any)?.id)
                                        const showUnreadDivider =
                                            firstUnreadMessageId != null &&
                                            Number.isFinite(numericMsgId) &&
                                            numericMsgId > 0 &&
                                            numericMsgId === firstUnreadMessageId

                                        return (
                                            <div key={msg.id}>
                                                {/* Unread Divider */}
                                                {showUnreadDivider && (
                                                    <div className="flex items-center justify-center my-4" ref={unreadDividerRef}>
                                                        <div className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300">
                                                            Unread messages
                                                        </div>
                                                    </div>
                                                )}
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

                                                {/* System Events */}
                                                {isSystemEvent ? (
                                                    <div className="flex justify-center">
                                                        <div className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300">
                                                            {msg.content}
                                                        </div>
                                                    </div>
                                                ) : isBot ? (
                                                    // Bot/automation/system messages render on the agent side with a robot avatar.
                                                    <div className="flex justify-end">
                                                        <div className="flex items-end gap-2 max-w-[70%]">
                                                            <div className="group relative bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-2xl px-4 py-2 shadow-sm border border-gray-200 dark:border-gray-700">
                                                                <p className="break-words whitespace-pre-wrap">{msg.content}</p>
                                                                <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                                    <span>{new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                </div>
                                                            </div>
                                                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-700 dark:text-gray-200 flex-shrink-0">
                                                                <Bot className="h-4 w-4" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                                                        <div className="flex items-end gap-2 max-w-[70%]">
                                                            {!isAgent && (
                                                                <UserAvatar
                                                                    seed={getVisitorAvatarSeed(conversation?.visitor_name, conversation?.session_id)}
                                                                    bgColor={conversation?.visitor_avatar_color}
                                                                    className="w-8 h-8 flex-shrink-0"
                                                                    iconClassName="w-8 h-8"
                                                                    title={conversation?.visitor_name || shortSessionId(conversation?.session_id)}
                                                                />
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
                                                                (() => {
                                                                    const avatarUrl = (msg as any).sender_avatar_url
                                                                    const name = (msg as any).sender_name
                                                                    if (avatarUrl) {
                                                                        const fullUrl = String(avatarUrl).startsWith('http') ? avatarUrl : `${API_BASE}${avatarUrl}`
                                                                        return (
                                                                            <img
                                                                                src={fullUrl}
                                                                                alt={name || 'Agent'}
                                                                                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                                                            />
                                                                        )
                                                                    }
                                                                    return (
                                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                                                            {getInitials(name, 'AG')}
                                                                        </div>
                                                                    )
                                                                })()
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
                        <div className="flex gap-2 mb-2 items-center">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                onClick={() => wrapSelection('**', '**')}
                                title="Bold"
                            >
                                <Bold className="h-4 w-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                onClick={() => wrapSelection('*', '*')}
                                title="Italic"
                            >
                                <Italic className="h-4 w-4" />
                            </Button>

                            <DropdownMenu>
                                <DropdownMenuTrigger>
                                    <Button type="button" variant="ghost" size="sm" className="dark:text-gray-400" title="Emoji">
                                        <Smile className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-64">
                                    <DropdownMenuLabel>Emojis</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <div className="grid grid-cols-8 gap-2 p-2">
                                        {[
                                            '😀', '😁', '😂', '😊', '😍', '🤔', '👍', '🙏',
                                            '🎉', '😢', '😡', '😎', '❤️', '🔥', '✅', '❓'
                                        ].map((emoji) => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-lg"
                                                onClick={() => insertAtCursor(emoji)}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0]
                                    if (!file || !selectedChat) return

                                    setUploadingAttachment(true)
                                    try {
                                        const form = new FormData()
                                        form.append('file', file)

                                        const token = localStorage.getItem('auth_token')
                                        const resp = await fetch(
                                            `${API_BASE}/attachments/upload?conversation_id=${selectedChat}`,
                                            {
                                                method: 'POST',
                                                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                                                body: form,
                                            }
                                        )

                                        if (!resp.ok) {
                                            const err = await resp.json().catch(() => ({}))
                                            throw new Error(err?.detail || 'Failed to upload attachment')
                                        }

                                        const data = await resp.json()
                                        const url = data?.url ? String(data.url) : ''
                                        const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`
                                        insertAtCursor(fullUrl)
                                    } catch (err) {
                                        console.error('Attachment upload failed:', err)
                                    } finally {
                                        setUploadingAttachment(false)
                                        // allow re-selecting the same file
                                        if (fileInputRef.current) fileInputRef.current.value = ''
                                    }
                                }}
                            />

                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="dark:text-gray-400"
                                title="Attach file"
                                disabled={!selectedChat || uploadingAttachment}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Paperclip className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="min-h-[20px] text-xs text-gray-500 dark:text-gray-400 px-1">
                            {visitorTyping ? 'Visitor is typing…' : ''}
                        </div>

                        <div className="relative flex gap-2">
                            {(() => {
                                const { open, matches } = getShortcutMatches(input, selectedWebsiteId)
                                if (!open || matches.length === 0) return null

                                return (
                                    <div className="absolute bottom-full left-0 mb-2 w-full max-w-lg rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden z-50">
                                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Shortcuts</div>
                                        <div className="max-h-64 overflow-auto">
                                            {matches.map((s, idx) => (
                                                <button
                                                    key={`${s.scope}-${s.id}`}
                                                    type="button"
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${idx === shortcutMenuIndex ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                                                    onMouseEnter={() => setShortcutMenuIndex(idx)}
                                                    onClick={() => {
                                                        setInput(s.message)
                                                        setShortcutMenuOpen(false)
                                                        setShortcutMenuIndex(0)
                                                        requestAnimationFrame(() => composerRef.current?.focus())
                                                    }}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div className="font-mono text-gray-900 dark:text-gray-100">/{s.shortcut}</div>
                                                        <div className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                                            {s.scope === 'website' ? 'Website' : 'Personal'}
                                                        </div>
                                                    </div>
                                                    <div className="text-gray-600 dark:text-gray-400 truncate">{s.message}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })()}

                            <Textarea
                                ref={composerRef}
                                value={input}
                                onChange={(e) => {
                                    const v = e.target.value
                                    setInput(v)
                                    const { open, matches } = getShortcutMatches(v, selectedWebsiteId)
                                    setShortcutMenuOpen(open && matches.length > 0)
                                    setShortcutMenuIndex(0)
                                    scheduleAgentTyping(v)
                                }}
                                onKeyDown={(e) => {
                                    const { open, matches } = getShortcutMatches(input, selectedWebsiteId)
                                    if (open && matches.length > 0) {
                                        if (e.key === 'ArrowDown') {
                                            e.preventDefault()
                                            setShortcutMenuIndex((i) => Math.min(i + 1, matches.length - 1))
                                            return
                                        }
                                        if (e.key === 'ArrowUp') {
                                            e.preventDefault()
                                            setShortcutMenuIndex((i) => Math.max(i - 1, 0))
                                            return
                                        }
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault()
                                            const picked = matches[shortcutMenuIndex] || matches[0]
                                            if (picked) {
                                                setInput(picked.message)
                                                setShortcutMenuOpen(false)
                                                setShortcutMenuIndex(0)
                                            }
                                            return
                                        }
                                        if (e.key === 'Escape') {
                                            e.preventDefault()
                                            setShortcutMenuOpen(false)
                                            return
                                        }
                                    }

                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault()
                                        handleSendMessage()
                                    }
                                }}
                                placeholder="Reply to live chat"
                                className="flex-1 dark:bg-gray-700 dark:border-gray-600 min-h-[44px]"
                                disabled={isResolvedSelected}
                            />

                            <Button
                                onClick={handleSendMessage}
                                disabled={!input.trim() || isResolvedSelected}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                <Send className="h-4 w-4" />
                            </Button>
                        </div>
                        {isResolvedSelected && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                This conversation is resolved and read-only.
                            </p>
                        )}
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
                            Great! Use the spare time and learn some best practices for supporting visitors.
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
                            <UserAvatar
                                seed={getVisitorAvatarSeed(conversation?.visitor_name, conversation?.session_id)}
                                bgColor={conversation?.visitor_avatar_color}
                                className="w-10 h-10"
                                iconClassName="w-10 h-10"
                                title={conversation?.visitor_name || shortSessionId(conversation?.session_id)}
                            />
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
                                    browsingHistory={browsingHistory}
                                    onUpdateMetadata={async (data) => {
                                        if (!conversation?.id) return
                                        try {
                                            const resp = (await updateConversationMetadata(conversation.id, data)) as {
                                                visitor_name?: string | null
                                                visitor_email?: string | null
                                                visitor_phone?: string | null
                                            }

                                            const updates: Partial<ConversationDetails> = {
                                                visitor_name: resp?.visitor_name ?? undefined,
                                                visitor_email: resp?.visitor_email ?? undefined,
                                                visitor_phone: resp?.visitor_phone ?? undefined,
                                            }

                                            setConversation((prev) => (prev ? ({ ...prev, ...updates } as any) : prev))

                                            // Zustand setter expects the full array, not an updater function.
                                            setActiveChats(
                                                activeChats.map((c) =>
                                                    c.id === conversation.id ? ({ ...(c as any), ...updates } as any) : c
                                                )
                                            )

                                            setResolvedChats((prev) =>
                                                (Array.isArray(prev) ? prev : []).map((c) =>
                                                    (c as any).id === conversation.id ? ({ ...(c as any), ...updates } as any) : c
                                                )
                                            )
                                        } catch (e) {
                                            console.error('Failed to update visitor metadata:', e)
                                        }
                                    }}
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
