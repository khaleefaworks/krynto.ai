import { useEffect, useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react'
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom'
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
import ChatComposer from '@/components/chat/ChatComposer'
import MarkdownMessage from '@/components/chat/MarkdownMessage'
import Logo from '@/components/Logo'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isAdmin, isAgent } from '@/lib/roles'
import {
    Check,
    MessageCircle,
    Search,
    ChevronLeft,
    ChevronRight,
    PanelRightClose,
    PanelRightOpen,
    Inbox,
    Users,
    Bot,
    Plus,
    X
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

function conversationDisplayName(chat: { visitor_name?: string | null; title?: string | null; short_id?: string | null; session_id?: string | null } | null | undefined): string {
    if (!chat) return ''
    const name = String(chat.visitor_name || '').trim()
    if (name) return name
    const title = String(chat.title || '').trim()
    if (title) return title
    const shortId = String(chat.short_id || '').trim()
    if (shortId) return shortId
    return shortSessionId(chat.session_id)
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

function getVisitorAvatarSeed(visitorName: string | null | undefined, sessionId: string | null | undefined): string {
    const sid = String(sessionId || '').trim()
    if (sid) return sid
    const name = String(visitorName || '').trim()
    return name || 'visitor'
}

function isDarkMode(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function getTagPillBackground(color: unknown): string {
    const raw = String(color || '').trim()
    if (!raw) return 'transparent'

    // A bit stronger in dark mode so it stays visible.
    const alpha = isDarkMode() ? 0.30 : 0.18
    const pct = `${Math.round(alpha * 100)}%`

    // If it's a valid CSS color but not hex, lean on color-mix.
    if (!raw.startsWith('#')) {
        // color-mix() is supported in modern Chromium/Firefox/Safari.
        // If unsupported, browser will drop it and we fall back to transparent.
        return `color-mix(in srgb, ${raw} ${pct}, transparent)`
    }

    const hex = raw.slice(1)
    const normalized =
        hex.length === 3
            ? hex.split('').map((c) => c + c).join('')
            : hex.length === 6
                ? hex
                : ''

    if (!normalized) return 'transparent'
    const r = parseInt(normalized.slice(0, 2), 16)
    const g = parseInt(normalized.slice(2, 4), 16)
    const b = parseInt(normalized.slice(4, 6), 16)
    if (![r, g, b].every((n) => Number.isFinite(n))) return 'transparent'

    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function TagIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" focusable="false" role="presentation" className={className} aria-hidden="true">
            <path
                fill="currentColor"
                d="M21.41 11.58L12.41 2.58A2 2 0 0 0 11 2H4A2 2 0 0 0 2 4V11A2 2 0 0 0 2.59 12.42L11.59 21.42A2 2 0 0 0 13 22A2 2 0 0 0 14.41 21.41L21.41 14.41A2 2 0 0 0 22 13A2 2 0 0 0 21.41 11.58M13 20L4 11V4H11L20 13M6.5 5A1.5 1.5 0 1 1 5 6.5A1.5 1.5 0 0 1 6.5 5Z"
            ></path>
        </svg>
    )
}

interface ConversationDetails {
    id: number
    short_id?: string
    website_id?: number
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
    team_id?: number | null
    closed_by?: string | null
    title?: string | null
}

interface VisitorConversation {
    id: number
    short_id: string
    status: string
    title: string | null
    closed_by: string | null
    created_at: string | null
    last_visitor_message_at: string | null
}

type FilterCategory = 'all' | 'mine' | 'unassigned' | 'resolved'

export default function ConversationsView() {
    const { chatId: chatIdParam, conversationId } = useParams<{ chatId?: string; conversationId?: string }>()
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
    const spectatorAgentTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const connectedWebsiteIdRef = useRef<number | null>(null)

    const [resolvedChats, setResolvedChats] = useState<any[]>([])
    const [resolvedLoading, setResolvedLoading] = useState(false)
    const [visitorTyping, setVisitorTyping] = useState(false)
    const [spectatorAgentTyping, setSpectatorAgentTyping] = useState<string | null>(null)

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

    const [personalShortcuts, setPersonalShortcuts] = useState<PersonalShortcut[]>([])
    const [websiteShortcutsByWebsiteId, setWebsiteShortcutsByWebsiteId] = useState<Record<number, WebsiteShortcut[]>>({})
    const websiteShortcutsTokenRef = useRef(0)

    const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<number | null>(null)

    // Takeover confirmation (Smartsupp-like)
    const [showTakeoverConfirm, setShowTakeoverConfirm] = useState(false)
    const [pendingSendMessage, setPendingSendMessage] = useState<string | null>(null)

    // Conversation details state
    const [conversation, setConversation] = useState<ConversationDetails | null>(null)
    const [notes, setNotes] = useState<Note[]>([])
    const [browsingHistory, setBrowsingHistory] = useState<any[]>([])
    const [conversationRating, setConversationRating] = useState<{ rating: number; feedback?: string } | null>(null)
    const [availableTags, setAvailableTags] = useState<any[]>([])
    const [conversationTags, setConversationTags] = useState<any[]>([])
    const [visitorConversations, setVisitorConversations] = useState<VisitorConversation[]>([])

    const [availableTeams, setAvailableTeams] = useState<any[]>([])
    const [teamPickerOpen, setTeamPickerOpen] = useState(false)
    const [teamPickerQuery, setTeamPickerQuery] = useState('')

    const [tagPickerOpen, setTagPickerOpen] = useState(false)
    const [tagPickerQuery, setTagPickerQuery] = useState('')

    const unassignedTags = useMemo(() => {
        const assigned = new Set(conversationTags.map((t: any) => Number(t?.id)))
        return availableTags
            .filter((t: any) => !assigned.has(Number(t?.id)))
            .slice()
            .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))
    }, [availableTags, conversationTags])

    const filteredUnassignedTags = useMemo(() => {
        const q = String(tagPickerQuery || '').trim().toLowerCase()
        if (!q) return unassignedTags
        return unassignedTags.filter((t: any) => String(t?.name || '').toLowerCase().includes(q))
    }, [unassignedTags, tagPickerQuery])

    const selectedTeam = useMemo(() => {
        const teamId = Number((conversation as any)?.team_id)
        if (!Number.isFinite(teamId) || teamId <= 0) return null
        return availableTeams.find((t: any) => Number(t?.id) === teamId) || null
    }, [availableTeams, conversation])

    const filteredTeams = useMemo(() => {
        const q = String(teamPickerQuery || '').trim().toLowerCase()
        const base = (Array.isArray(availableTeams) ? availableTeams : [])
            .slice()
            .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))
        if (!q) return base
        return base.filter((t: any) => String(t?.name || '').toLowerCase().includes(q))
    }, [availableTeams, teamPickerQuery])

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

        // NOTE: visitor_message for the selected chat is handled by the local WS
        // handler (addMessage(dto)) which adds the message DTO instantly without an
        // API round-trip.  A redundant loadChatData here would clear + re-fetch,
        // causing a visible flash/delay.

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
        if (!chatIdParam) return null
        // Canonical route: /dashboard/chats/:chatId where chatId is the short_id
        // Look up the conversation by short_id in loaded chats
        const matched = activeChats.find((c) => c.short_id === chatIdParam)
            || resolvedChats.find((c: any) => c.short_id === chatIdParam)
        if (matched) return matched.id
        // Legacy: try numeric ID for backward compat
        const fromParam = Number(chatIdParam)
        if (Number.isFinite(fromParam) && fromParam > 0) return fromParam
        const fromLegacyParam = Number(conversationId)
        if (Number.isFinite(fromLegacyParam) && fromLegacyParam > 0) return fromLegacyParam
        return null
    }, [isChatsListRoute, chatIdParam, conversationId, activeChats, resolvedChats])

    // When navigating back to the chats list (/dashboard/chats), clear any previously
    // selected chat so the empty-state screen renders (instead of persisting the thread view).
    useEffect(() => {
        if (!isChatsListRoute) return
        if (selectedChat === null) return
        setSelectedChat(null)
        setConversation(null)
        setVisitorConversations([])
        setInput('')
        setVisitorTyping(false)
        setSpectatorAgentTyping(null)
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
    // Canonical URL is /dashboard/chats/:chatId where chatId is the conversation PK.
    useEffect(() => {
        const preferredId = getPreferredConversationId()
        if (preferredId) {
            if (preferredId !== selectedChat) {
                openChat(preferredId)
            }
            return
        }
    }, [getPreferredConversationId, selectedChat, openChat])

    // Deep-link fallback: when chatIdParam is a short_id not found in loaded chats,
    // fetch the conversation from the API and inject it so it can be selected.
    useEffect(() => {
        if (isChatsListRoute || !chatIdParam) return
        // If already resolved (found in active/resolved chats), skip
        if (getPreferredConversationId() !== null) return
        // Only run after initial chats have loaded
        if (!hasLoadedChatsRef.current) return
        // Don't retry if we already selected something
        if (selectedChat) return

        let cancelled = false
        ;(async () => {
            try {
                const summary = await apiRequest<any>(`/chats/${chatIdParam}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
                })
                if (cancelled || !summary?.id) return
                // Inject into activeChats so it appears in the left list
                setActiveChats([{ ...summary, current_agent_id: summary.assigned_agent_id }, ...activeChats])
                openChat(summary.id)
            } catch {
                // Conversation not found or no access — ignore
            }
        })()

        return () => { cancelled = true }
    }, [isChatsListRoute, chatIdParam, selectedChat, activeChats, openChat])

    // Legacy deep-link support: /dashboard/chats/conversation/:conversationId -> redirect to canonical URL.
    useEffect(() => {
        const cid = Number(conversationId)
        if (!Number.isFinite(cid) || cid <= 0) return
        // Look up short_id for canonical URL
        const matched = activeChats.find((c) => c.id === cid)
            || resolvedChats.find((c: any) => c.id === cid)
        if (matched?.short_id) {
            navigate(`/dashboard/chats/${matched.short_id}`, { replace: true })
        }
    }, [conversationId, navigate, activeChats, resolvedChats])

    // Helper to get short_id for a conversation
    const getShortId = useCallback((chatId: number): string | null => {
        const chat = activeChats.find((c) => c.id === chatId)
            || resolvedChats.find((c: any) => c.id === chatId)
        return (chat as any)?.short_id || null
    }, [activeChats, resolvedChats])

    // Load chat when selected
    useEffect(() => {
        if (selectedChat) {
            const shortId = getShortId(selectedChat)
            if (shortId && shortId !== chatIdParam) {
                navigate(`/dashboard/chats/${shortId}`)
            }
        }

        if (selectedChat) {
            setFirstUnreadMessageId(null)
            hasScrolledToUnreadRef.current = false
            isAtBottomRef.current = true
            setVisitorTyping(false)
            setSpectatorAgentTyping(null)
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

    // Global WebSocket: connect once and handle list-level events (no chat selection required)
    useEffect(() => {
        if (!user?.id) return

        connectAgentSocket(0, user.id)
        connectedWebsiteIdRef.current = null

        const removeHandler = addMessageHandler((data) => {
            const dataConversationId = Number((data as any)?.conversation_id)

            if (data.type === 'conversation_team_changed') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'conversation_assigned') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'conversation_closed') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'new_conversation') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'connected') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'visitor_closed_chat' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'visitor_left_website' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'visitor_socket_connected' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'visitor_message' && dataConversationId) {
                // Update list preview for any visitor message (even if no chat is selected)
                const dto = (data as any)?.message_obj
                const content = (dto && typeof dto === 'object' ? (dto as any)?.content : null) ?? (data as any)?.message
                const ts = (dto && typeof dto === 'object'
                    ? ((dto as any)?.timestamp || (dto as any)?.created_at)
                    : null) || new Date().toISOString()
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

                if (typeof unreadCountRaw === 'number' && Number.isFinite(unreadCountRaw)) {
                    setUnreadForConversation(dataConversationId, unreadCountRaw)
                } else {
                    const delta = typeof deltaRaw === 'number' && Number.isFinite(deltaRaw) ? deltaRaw : 1
                    incrementUnreadForConversation(dataConversationId, delta)
                }
                scheduleUnreadRefresh()
            }
        })

        return removeHandler
    }, [user?.id])

    // Chat-specific WebSocket handler: registered when a chat is selected
    useEffect(() => {
        if (!selectedChat || !user?.id) return

        const removeHandler = addMessageHandler((data) => {
            const dataConversationId = Number((data as any)?.conversation_id)

            // Visitor message for the SELECTED chat — add to message thread
            if (data.type === 'visitor_message' && dataConversationId === selectedChat) {
                setVisitorTyping(false)
                if (visitorTypingTimerRef.current) {
                    clearTimeout(visitorTypingTimerRef.current)
                    visitorTypingTimerRef.current = null
                }
                const dto = (data as any)?.message_obj
                if (dto && typeof dto === 'object') {
                    addMessage(dto)

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
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }

                if (!isAtBottomRef.current) {
                    const dtoId = dto && typeof dto === 'object' ? Number((dto as any).id) : NaN
                    if (!firstUnreadMessageId && Number.isFinite(dtoId) && dtoId > 0) {
                        setFirstUnreadMessageId(dtoId)
                    }
                    incrementUnreadForConversation(selectedChat, 1)
                } else if (!firstUnreadMessageId) {
                    markChatRead(selectedChat).then(() => {
                        setUnreadForConversation(selectedChat, 0)
                    }).catch(() => { })
                }
            } else if (data.type === 'conversation_unread' && dataConversationId === selectedChat) {
                // Agent is viewing this chat — suppress badge
                return
            } else if (data.type === 'message_sent' && dataConversationId === selectedChat) {
                stopAgentTyping(selectedChat)

                const availabilityChanged = Boolean((data as any)?.availability_changed)
                const agentIsAvailable = (data as any)?.agent_is_available
                if (availabilityChanged && agentIsAvailable === true) {
                    const current = useAppStore.getState().user
                    if (current && current.is_available === false) {
                        setUser({ ...current, is_available: true })
                    }
                }

                const dto = (data as any)?.message_obj
                if (dto && typeof dto === 'object') {
                    const clientId = String((data as any)?.client_message_id || '').trim()
                    if (clientId) {
                        reconcileOptimisticMessage(`tmp:${clientId}`, dto)
                    } else {
                        addMessage(dto)
                    }

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
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'conversation_team_changed' && dataConversationId === selectedChat) {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'conversation_closed' && dataConversationId === selectedChat) {
                setSelectedChat(null)
                navigate('/dashboard/chats')
            } else if (data.type === 'visitor_closed_chat' && dataConversationId === selectedChat) {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'visitor_left_website' && dataConversationId === selectedChat) {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'visitor_socket_connected' && dataConversationId === selectedChat) {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'connected') {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
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
            } else if (data.type === 'agent_typing' && dataConversationId === selectedChat) {
                // Another agent is typing in this conversation (spectator view).
                const isTyping = Boolean((data as any)?.is_typing)
                const agentName = String((data as any)?.agent_name || 'Agent')
                if (isTyping) {
                    setSpectatorAgentTyping(agentName)
                    if (spectatorAgentTypingTimerRef.current) {
                        clearTimeout(spectatorAgentTypingTimerRef.current)
                    }
                    spectatorAgentTypingTimerRef.current = setTimeout(() => {
                        spectatorAgentTypingTimerRef.current = null
                        setSpectatorAgentTyping(null)
                    }, 3000)
                } else {
                    setSpectatorAgentTyping(null)
                    if (spectatorAgentTypingTimerRef.current) {
                        clearTimeout(spectatorAgentTypingTimerRef.current)
                        spectatorAgentTypingTimerRef.current = null
                    }
                }
            } else if (data.type === 'agent_message' && dataConversationId === selectedChat) {
                // An assigned agent sent a message — spectating agents receive it here.
                setSpectatorAgentTyping(null)
                if (spectatorAgentTypingTimerRef.current) {
                    clearTimeout(spectatorAgentTypingTimerRef.current)
                    spectatorAgentTypingTimerRef.current = null
                }
                const dto = (data as any)?.message_obj
                if (dto && typeof dto === 'object') {
                    addMessage(dto)
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
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'system_message' && dataConversationId === selectedChat) {
                // System events (e.g. "Agent joined the chat.") broadcast to all spectating agents.
                const dto = (data as any)?.message_obj
                if (dto && typeof dto === 'object') {
                    addMessage(dto)
                } else {
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'page_view' && dataConversationId === selectedChat) {
                getBrowsingHistory(selectedChat)
                    .then((hist) => setBrowsingHistory(Array.isArray(hist) ? hist : []))
                    .catch(() => { })
            }
        })

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

                // Fetch tags scoped to the conversation's website
                const wid = (chatData as any).website_id
                if (wid) {
                    apiRequest<any[]>(`/websites/${wid}/tags`).then(tags => {
                        if (loadDetailsTokenRef.current === token) {
                            setAvailableTags(Array.isArray(tags) ? tags : [])
                        }
                    }).catch(() => {
                        if (loadDetailsTokenRef.current === token) {
                            setAvailableTags([])
                        }
                    })

                    // Fetch teams scoped to the conversation's website
                    apiRequest<any[]>(`/websites/${wid}/teams`).then(teams => {
                        if (loadDetailsTokenRef.current === token) {
                            setAvailableTeams(Array.isArray(teams) ? teams : [])
                        }
                    }).catch(() => {
                        if (loadDetailsTokenRef.current === token) {
                            setAvailableTeams([])
                        }
                    })
                }
            } else {
                try {
                    const summary = await fetchChatSummary(chatId)
                    if (loadDetailsTokenRef.current === token) {
                        setConversation(summary as any)
                        setConversationTags(((summary as any).tags || []) as any)

                        // Temporarily inject into activeChats so it appears in the left list
                        // (e.g. bot-only conversations opened from the Visitors page).
                        if (!activeChats.some(c => c.id === chatId)) {
                            setActiveChats([summary as any, ...activeChats])
                        }
                    }

                    const wid = (summary as any).website_id
                    if (wid) {
                        apiRequest<any[]>(`/websites/${wid}/tags`).then(tags => {
                            if (loadDetailsTokenRef.current === token) {
                                setAvailableTags(Array.isArray(tags) ? tags : [])
                            }
                        }).catch(() => {
                            if (loadDetailsTokenRef.current === token) {
                                setAvailableTags([])
                            }
                        })

                        apiRequest<any[]>(`/websites/${wid}/teams`).then(teams => {
                            if (loadDetailsTokenRef.current === token) {
                                setAvailableTeams(Array.isArray(teams) ? teams : [])
                            }
                        }).catch(() => {
                            if (loadDetailsTokenRef.current === token) {
                                setAvailableTeams([])
                            }
                        })
                    }
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

            let fetchedRating: { rating: number; feedback?: string } | null = null
            try {
                const ratingResp = await apiRequest<{ rating: { rating: number; feedback?: string } | null }>(`/ratings/${chatId}`)
                fetchedRating = ratingResp?.rating ?? null
            } catch {
                fetchedRating = null
            }

            if (loadDetailsTokenRef.current !== token) {
                return
            }
            setNotes(fetchedNotes)
            setBrowsingHistory(Array.isArray(fetchedHistory) ? fetchedHistory : [])
            setConversationRating(fetchedRating)

            // Fetch other conversations from this visitor (best-effort, non-blocking).
            apiRequest<VisitorConversation[]>(`/chats/${chatId}/visitor-history`)
                .then((data) => {
                    if (loadDetailsTokenRef.current === token) {
                        setVisitorConversations(Array.isArray(data) ? data : [])
                    }
                })
                .catch(() => {
                    if (loadDetailsTokenRef.current === token) setVisitorConversations([])
                })
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
            const tag = availableTags.find(t => Number((t as any)?.id) === tagId)
            if (tag) {
                setConversationTags(prev => [...prev.filter(t => Number((t as any)?.id) !== tagId), tag])
            }
            // Also update in activeChats list to keep it in sync
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat
                    ? { ...c, tags: [...((c as any).tags || []).filter((t: any) => Number(t?.id) !== tagId), tag] }
                    : c
            ))
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
            setConversationTags(prev => prev.filter(t => Number((t as any)?.id) !== tagId))
            // Also update in activeChats list
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat
                    ? { ...c, tags: ((c as any).tags || []).filter((t: any) => Number(t?.id) !== tagId) }
                    : c
            ))
        } catch (error) {
            console.error("Failed to remove tag:", error)
        }
    }

    const handleSetTeam = async (teamId: number | null) => {
        if (!selectedChat) return
        try {
            await apiRequest(`/conversations/${selectedChat}/team`, {
                method: 'PUT',
                body: JSON.stringify({ team_id: teamId })
            })

            setConversation((prev) => (prev ? ({ ...(prev as any), team_id: teamId } as any) : prev))

            // Re-fetch from server so visibility / team-scope filtering is applied
            await fetchActiveChats({ showSpinner: false })
        } catch (error) {
            console.error('Failed to set team:', error)
        }
    }

    const handleSendMessage = async (overrideContent?: string) => {
        const raw = typeof overrideContent === 'string' ? overrideContent : input
        if (!raw.trim() || !selectedChat) return
        if (isResolvedSelected) return

        const messageContent = raw.trim()
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
        let cancelled = false
        const load = async () => {
            try {
                if (activeFilter === 'resolved') setResolvedLoading(true)
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
                return <MessageCircle className="h-5 w-5" />
            case 'mine':
                return <Users className="h-5 w-5" />
            case 'unassigned':
                return <Inbox className="h-5 w-5" />
            case 'resolved':
                return <Check className="h-5 w-5" />
            default:
                return <MessageCircle className="h-5 w-5" />
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
                                                <MessageCircle className="h-5 w-5 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open').length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <MessageCircle className="h-5 w-5 flex-shrink-0" />
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
                            <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
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
                                            title={conversationDisplayName(chat as any)}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-gray-900 dark:text-white truncate">
                                                    {conversationDisplayName(chat as any)}
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
                                    title={conversationDisplayName(conversation as any)}
                                />
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                                        {conversationDisplayName(conversation as any)}
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

                        {/* Second row: Tag conversation (left) | Assign team (right) */}
                        <div className="mt-2 flex items-start justify-between gap-4">
                            {/* LEFT — Tag conversation + tag badges */}
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                {conversationTags
                                    .slice()
                                    .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))
                                    .map((t: any) => (
                                        <Badge
                                            key={t.id}
                                            variant="outline"
                                            className="gap-1"
                                            style={{
                                                borderColor: String(t?.color || ''),
                                                color: String(t?.color || ''),
                                                backgroundColor: getTagPillBackground(t?.color),
                                            }}
                                        >
                                            <span className="truncate max-w-40">{t.name}</span>
                                            <button
                                                type="button"
                                                className="ml-1 opacity-80 hover:opacity-100 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                                onClick={() => handleRemoveTag(Number(t.id))}
                                                aria-label={`Remove tag ${String(t.name || '')}`}
                                                title="Remove"
                                            >
                                                ×
                                            </button>
                                        </Badge>
                                    ))}

                                <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                                    <PopoverTrigger asChild>
                                        {conversationTags.length === 0 ? (
                                            <Button
                                                type="button"
                                                variant="link"
                                                className="h-auto p-0 gap-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                            >
                                                <TagIcon className="h-4 w-4" />
                                                Tag conversation
                                            </Button>
                                        ) : (
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="outline"
                                                className="h-7 w-7 rounded-full"
                                                aria-label="Add tag"
                                                title="Add tag"
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </PopoverTrigger>

                                    <PopoverContent
                                        align="start"
                                        className="w-80 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg"
                                    >
                                        <div className="space-y-2">
                                            <Input
                                                value={tagPickerQuery}
                                                onChange={(e) => setTagPickerQuery(e.target.value)}
                                                placeholder="Search tags…"
                                                className="h-9"
                                                autoFocus
                                            />

                                            <div className="max-h-56 overflow-auto rounded-md border border-gray-200 dark:border-gray-700">
                                                {filteredUnassignedTags.length === 0 ? (
                                                    <div className="p-2 text-xs text-gray-500 dark:text-gray-400">No matching tags</div>
                                                ) : (
                                                    <div className="p-1">
                                                        {filteredUnassignedTags.map((t: any) => (
                                                            <button
                                                                key={t.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    handleAddTag(Number(t.id))
                                                                    setTagPickerOpen(false)
                                                                    setTagPickerQuery('')
                                                                }}
                                                                className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                            >
                                                                <span
                                                                    className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                                                    style={{ backgroundColor: String(t?.color || '#6b7280') }}
                                                                />
                                                                <span className="truncate">{t.name}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {isAdmin(user) ? (
                                                <div className="pt-1 text-right">
                                                    <Link
                                                        to={`/dashboard/settings/websites/${(conversation as any)?.website_id ?? ''}?tab=tags`}
                                                        className="text-xs text-gray-600 dark:text-gray-300 hover:underline"
                                                        onClick={() => {
                                                            setTagPickerOpen(false)
                                                            setTagPickerQuery('')
                                                        }}
                                                    >
                                                        Manage tags
                                                    </Link>
                                                </div>
                                            ) : null}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            {/* RIGHT — Assign team + team badge */}
                            <div className="flex flex-wrap items-center justify-end gap-2 flex-shrink-0">
                                {selectedTeam ? (
                                    <div
                                        className={`inline-flex items-center gap-1.5 rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300${isAdmin(user) ? ' cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors' : ''}`}
                                        onClick={isAdmin(user) ? () => setTeamPickerOpen(true) : undefined}
                                        title={isAdmin(user) ? 'Click to change team' : String((selectedTeam as any)?.name || '')}
                                    >
                                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="text-blue-500 dark:text-blue-400">Team:</span>
                                        <span className="truncate max-w-32 font-semibold">{String((selectedTeam as any)?.name || '')}</span>
                                        {isAdmin(user) && (
                                            <button
                                                type="button"
                                                className="ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                                onClick={(e) => { e.stopPropagation(); handleSetTeam(null) }}
                                                aria-label="Clear team"
                                                title="Remove team assignment"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                ) : null}

                                {isAdmin(user) && (
                                    <Popover open={teamPickerOpen} onOpenChange={setTeamPickerOpen}>
                                        {!selectedTeam ? (
                                            <PopoverTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="link"
                                                    className="h-auto p-0 gap-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                >
                                                    <Users className="h-4 w-4" />
                                                    Assign team
                                                </Button>
                                            </PopoverTrigger>
                                        ) : null}

                                        <PopoverContent
                                            align="end"
                                            className="w-80 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg"
                                        >
                                            <div className="space-y-2">
                                                <Input
                                                    value={teamPickerQuery}
                                                    onChange={(e) => setTeamPickerQuery(e.target.value)}
                                                    placeholder="Search teams…"
                                                    className="h-9"
                                                    autoFocus
                                                />

                                                <div className="max-h-56 overflow-auto rounded-md border border-gray-200 dark:border-gray-700">
                                                    {filteredTeams.length === 0 ? (
                                                        <div className="p-2 text-xs text-gray-500 dark:text-gray-400">No matching teams</div>
                                                    ) : (
                                                        <div className="p-1">
                                                            {filteredTeams.map((t: any) => (
                                                                <button
                                                                    key={t.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const id = Number(t?.id)
                                                                        if (!Number.isFinite(id) || id <= 0) return
                                                                        handleSetTeam(id)
                                                                        setTeamPickerOpen(false)
                                                                        setTeamPickerQuery('')
                                                                    }}
                                                                    className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                                >
                                                                    <span className="truncate">{String(t?.name || '')}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {isAdmin(user) ? (
                                                    <div className="pt-1 text-right">
                                                        <Link
                                                            to={`/dashboard/settings/websites/${(conversation as any)?.website_id ?? ''}?tab=teams`}
                                                            className="text-xs text-gray-600 dark:text-gray-300 hover:underline"
                                                            onClick={() => {
                                                                setTeamPickerOpen(false)
                                                                setTeamPickerQuery('')
                                                            }}
                                                        >
                                                            Manage teams
                                                        </Link>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                )}
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
                                    <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
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
                                                        <div className="flex items-end gap-2 max-w-[70%] min-w-0">
                                                            <div className="group relative bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-2xl px-4 py-2 shadow-sm border border-gray-200 dark:border-gray-700 min-w-0">
                                                                <MarkdownMessage content={msg.content} className="text-inherit" />
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
                                                        <div className="flex items-end gap-2 max-w-[70%] min-w-0">
                                                            {!isAgent && (
                                                                <UserAvatar
                                                                    seed={getVisitorAvatarSeed(conversation?.visitor_name, conversation?.session_id)}
                                                                    bgColor={conversation?.visitor_avatar_color}
                                                                    className="w-8 h-8 flex-shrink-0"
                                                                    iconClassName="w-8 h-8"
                                                                    title={conversationDisplayName(conversation as any)}
                                                                />
                                                            )}
                                                            <div className={`group relative min-w-0 ${isAgent ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'} rounded-2xl px-4 py-2 shadow-sm`}>
                                                                <MarkdownMessage content={msg.content} className="text-inherit" />
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

                    <ChatComposer
                        conversationId={selectedChat}
                        onTyping={scheduleAgentTyping}
                        onSend={(content) => handleSendMessage(content)}
                        disabled={isResolvedSelected}
                        placeholder="Reply to live chat"
                        statusText={visitorTyping ? 'Visitor is typing…' : spectatorAgentTyping ? `${spectatorAgentTyping} is typing…` : ''}
                        readOnlyText="This conversation is resolved and read-only."
                        personalShortcuts={personalShortcuts}
                        websiteShortcuts={selectedWebsiteId ? (websiteShortcutsByWebsiteId[selectedWebsiteId] || []) : []}
                    />
                </div>
            ) : (
                /* Empty State */
                <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="text-center max-w-2xl px-8">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                            <Logo size={56} dotColor={user?.is_available ? '#22c55e' : '#ef4444'} />
                        </div>
                        <h2 className="text-2xl font-semibold mb-3 text-gray-900 dark:text-white">Select a conversation</h2>
                        <p className="text-gray-600 dark:text-gray-400">
                            Choose a chat from the list to view messages and reply.
                        </p>
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
                                title={conversationDisplayName(conversation as any)}
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
                                    rating={conversationRating}
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

                                {/* Closed by label (only for resolved conversations) */}
                                {conversation.closed_by && conversation.status === 'resolved' && (
                                    <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/50">
                                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Closed by</p>
                                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${conversation.closed_by === 'agent'
                                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : conversation.closed_by === 'visitor'
                                                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                            }`}>
                                            {conversation.closed_by === 'agent' ? 'Agent' : conversation.closed_by === 'visitor' ? 'Visitor' : 'Inactivity'}
                                        </span>
                                    </div>
                                )}

                                {/* Other conversations from this visitor */}
                                {visitorConversations.length > 0 && (
                                    <div className="border-t border-gray-100 dark:border-gray-700/50">
                                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 pt-3 pb-2">
                                            Other conversations ({visitorConversations.length})
                                        </p>
                                        <div className="space-y-0.5 pb-2">
                                            {visitorConversations
                                                .slice()
                                                .sort((a, b) => (b.id) - (a.id))
                                                .map((vc) => (
                                                    <button
                                                        key={vc.id}
                                                        onClick={() => openChat(vc.id)}
                                                        className={`w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group ${selectedChat === vc.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                                                            }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                                                {vc.title || `Conversation #${vc.id}`}
                                                            </p>
                                                            <span className={`text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded-full ${vc.status === 'open'
                                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                                                }`}>
                                                                {vc.status === 'open' ? 'Open' : 'Resolved'}
                                                            </span>
                                                        </div>
                                                        {vc.created_at && (
                                                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                                                {new Date(vc.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                                            </p>
                                                        )}
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
