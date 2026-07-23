import { useEffect, useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react'
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useMessageStore } from '@/store/messages'
import { fetchActiveChats as fetchChatsApi } from '@/services/chats'
import { joinChat, closeConversation, takeoverConversation, markChatRead, fetchChatReadState, sendContactCard } from '@/services/chats'
import { updateAvailability } from '@/services/auth'
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
import { isPushSupported, testPushNotification } from '@/services/push'
import { updateConversationMetadata } from '@/services/conversationMetadata'
import { fetchChatSummary } from '@/services/chats'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ChatComposer, { type ChatComposerHandle } from '@/components/chat/ChatComposer'
import MarkdownMessage from '@/components/chat/MarkdownMessage'
import Logo from '@/components/Logo'
import DocsLink from '@/components/DocsLink'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isAdmin, isAgent, canAssignTeam } from '@/lib/roles'
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
    X,
    HelpCircle,
    SlidersHorizontal,
    Globe,
    UserRound,
    Calendar,
    Bell,
    BellRing,
    Loader2,
    CheckCircle2,
    AlertCircle,
    AlertTriangle,
    UserPlus,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import VisitorDetailsPanel from '@/components/VisitorDetailsPanel'
import UserAvatar from '@/components/UserAvatar'
import BotAvatarIcon from '@/components/BotAvatarIcon'
import { formatDistanceToNow } from 'date-fns'

// A leading "#" (1-6 of them, followed by whitespace or end-of-line) is
// valid — and often empty — CommonMark ATX heading syntax. The composer's
// escapeMarkdownText never escapes "#" when an agent types it as plain text
// (Heading is disabled in the editor, so nothing flags it as needing escaping
// at compose time), and unescapeMarkdown's own char class below doesn't cover
// "#" either. Left alone, a message that's just "#" (or "# ") renders as an
// empty, invisible <h1> in ReactMarkdown/remark-gfm instead of the literal
// character that was typed. Re-escaping it at render time (here, and again in
// escapeVisitorMarkdown below) guards both already-escaped and never-escaped
// content the same way, regardless of where it came from.
function escapeBareAtxHeading(s: string): string {
    return s.replace(/^([ \t]{0,3}#{1,6})(?=[ \t]|$)/gm, '\\$1')
}

// Reverse backslash-escape sequences added by the markdown serializer
// (e.g. \* → *, \\ → \). Matches what the widget's unescapeMarkdown does.
// Also normalises trailing whitespace *inside* closing delimiters (old message
// format bug): e.g. "***Hello! ***" → "***Hello!***".  CommonMark requires
// closing * delimiters to be right-flanking (not preceded by whitespace),
// otherwise ReactMarkdown falls back to rendering them as raw asterisks.
function unescapeMarkdown(s: string | null | undefined): string {
    return escapeBareAtxHeading(
        String(s || '')
            .replace(/\\([\\`*_[\]()/])/g, '$1')
            .replace(/\*\*\*([^*\n]*[^\s*\n])\s+\*\*\*/g, '***$1***')
            .replace(/\*\*([^*\n]*[^\s*\n])\s+\*\*/g, '**$1**')
            .replace(/\*([^*\n]*[^\s*\n])\s+\*/g, '*$1*')
    )
}

// Visitor-authored text is never intentional markdown (unlike agent/bot
// content, which comes from the rich composer and is meant to render as
// such) — only backslash-escape it so literal backslashes survive, plus
// guard against a leading "#" the same way unescapeMarkdown does above.
function escapeVisitorMarkdown(s: string | null | undefined): string {
    return escapeBareAtxHeading(String(s || '').replace(/\\/g, '\\\\'))
}

// CC1: a newly-sent contact card supersedes any older still-pending one in
// the same conversation — mirrors the widget's client-side
// _pendingContactCards supersede rule. contact_card_state is otherwise only
// computed server-side at message-serialize time, so without this the
// sending agent (and any spectating agent watching the same conversation)
// only sees the older card flip to "expired" after a full reload.
function supersedeOlderContactCards(newMessage: any) {
    if (!newMessage || newMessage.event_type !== 'contact_card') return
    const newId = Number(newMessage.id)
    if (!Number.isFinite(newId)) return
    const { messages, patchMessage } = useMessageStore.getState()
    messages.forEach((m: any) => {
        if (
            m?.event_type === 'contact_card' &&
            m?.conversation_id === newMessage.conversation_id &&
            Number(m?.id) < newId &&
            m?.contact_card_state?.status === 'pending'
        ) {
            patchMessage(m.id, { contact_card_state: { status: 'expired', reason: 'superseded' } })
        }
    })
}

// Strip markdown syntax for plain-text previews (chat list last message).
function stripMarkdownPreview(s: string | null | undefined): string {
    return String(s || '')
        .replace(/\\([\\`*_[\]()/])/g, '$1')    // unescape \* \_ etc. FIRST so patterns below see clean text
        .replace(/\*\*\*(.*?)\*\*\*/g, '$1')    // bold+italic ***text***
        .replace(/\*\*(.*?)\*\*/g, '$1')        // bold **text**
        .replace(/\*(.*?)\*/g, '$1')            // italic *text*
        .replace(/\n+/g, ' ')
        .trim()
}

function formatWhatsAppDate(dateLike: any): string {
    const t = dateLike ? new Date(dateLike).getTime() : NaN
    if (!Number.isFinite(t)) return ''

    const now = new Date()
    const then = new Date(t)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000
    const weekStart = todayStart - 6 * 86400000

    const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })

    if (t >= todayStart) return time
    if (t >= yesterdayStart) return 'Yesterday'
    if (t >= weekStart) return then.toLocaleDateString(undefined, { weekday: 'long' })
    if (then.getFullYear() === now.getFullYear())
        return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return `${then.getDate()}/${then.getMonth() + 1}/${then.getFullYear()}`
}

function formatLastSeen(dateLike: any): string {
    const t = dateLike ? new Date(dateLike).getTime() : NaN
    if (!Number.isFinite(t)) return ''

    const now = new Date()
    const then = new Date(t)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000
    const weekStart = todayStart - 6 * 86400000

    const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })

    if (t >= todayStart) return `today at ${time}`
    if (t >= yesterdayStart) return `yesterday at ${time}`
    if (t >= weekStart) return `${then.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
    if (then.getFullYear() === now.getFullYear())
        return `${then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`
    return `${then.getDate()}/${then.getMonth() + 1}/${then.getFullYear()} at ${time}`
}
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
    return formatWhatsAppDate(dateLike)
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

// closed_by values in use: 'agent', 'visitor', 'visitor_ended', 'bot',
// 'inactivity', 'system_auto'. Anything else falls back to the generic
// "Inactivity" bucket rather than a misleading label.
function closedByBadge(closedBy: string | null | undefined): { label: string; className: string } {
    switch (closedBy) {
        case 'agent':
            return { label: 'Agent', className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }
        case 'visitor':
        case 'visitor_ended':
            return { label: 'Visitor', className: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' }
        case 'bot':
            return { label: 'Bot', className: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' }
        default:
            return { label: 'Inactivity', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
    }
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

/** Corner badge for a visitor avatar showing who's handling the conversation.
 * bot_only always wins over a stale/leftover assigned_agent_id — no human
 * agent is actively handling the conversation once it's bot-only (same
 * precedence the "Mine"/"Unassigned" counts use). */
function HandlerBadge({
    botOnly,
    assignedAgentId,
    agent,
}: {
    botOnly?: boolean
    assignedAgentId?: number | null
    agent?: { id: number; name: string | null; avatar_url: string | null } | null
}) {
    if (botOnly) {
        return (
            <div className="absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 rounded-full border-2 border-white dark:border-gray-800 bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden"
                title="Handled by bot"
            >
                <BotAvatarIcon className="w-3.5 h-3.5" />
            </div>
        )
    }
    if (assignedAgentId) {
        const rawUrl = agent?.avatar_url ?? null
        const agentAvatarUrl = rawUrl ? (String(rawUrl).startsWith('http') ? rawUrl : `${API_BASE}${rawUrl}`) : null
        return (
            <div className="absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 rounded-full border-2 border-white dark:border-gray-800 bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden"
                title={agent?.name || `Agent #${assignedAgentId}`}
            >
                <UserAvatar
                    seed={String(assignedAgentId)}
                    imageUrl={agentAvatarUrl}
                    className="w-4 h-4"
                    iconClassName="w-4 h-4"
                    title={agent?.name ?? undefined}
                />
            </div>
        )
    }
    return null
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
    visitor_ip?: string | null
    visit_count?: number
    last_seen_at?: string
    visitor_avatar_color?: string | null
    created_at?: string
    last_message_at?: string
    status?: string
    team_id?: number | null
    closed_by?: string | null
    visitor_ended?: boolean
    title?: string | null
    bot_only?: boolean
    assigned_agent_id?: number | null
    assigned_agent?: { id: number; name: string | null; avatar_url: string | null } | null
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

type FilterCategory = 'all' | 'mine' | 'unassigned' | 'bot' | 'resolved'

function sortChatsByActivity(chats: any[]): any[] {
    return [...chats].sort((a, b) => {
        const ta = a.last_message_at || a.created_at || ''
        const tb = b.last_message_at || b.created_at || ''
        return tb < ta ? -1 : tb > ta ? 1 : 0
    })
}

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
    const { messages, addMessage, addMessages, reconcileOptimisticMessage, patchMessage, reset } = useMessageStore()

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
    const [resolvedOffset, setResolvedOffset] = useState(0)
    const [resolvedHasMore, setResolvedHasMore] = useState(false)
    const [resolvedLoadingMore, setResolvedLoadingMore] = useState(false)
    const [resolvedTotal, setResolvedTotal] = useState<number | null>(null)
    // Incremented when a conversation_closed WS event arrives so the resolved
    // list refetches even if the filter key (search/team/etc.) hasn't changed.
    const [resolvedRefreshCounter, setResolvedRefreshCounter] = useState(0)
    const [visitorTyping, setVisitorTyping] = useState(false)
    const [spectatorAgentTyping, setSpectatorAgentTyping] = useState<string | null>(null)

    // Filter state
    const [activeFilter, setActiveFilter] = useState<FilterCategory>('all')
    const [leftFilterCollapsed, setLeftFilterCollapsed] = useState(() => {
        const saved = localStorage.getItem('chat_left_filter_collapsed')
        return saved ? saved === 'true' : true
    })

    // Mobile visitor details overlay (below lg breakpoint)
    const [showMobileDetails, setShowMobileDetails] = useState(false)

    // List state
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')

    // Advanced conversation filters
    const [filterPanelOpen, setFilterPanelOpen] = useState(false)
    const [filterWebsiteId, setFilterWebsiteId] = useState<number | null>(null)
    const [filterAgentId, setFilterAgentId] = useState<number | null>(null)
    const [filterTeamId, setFilterTeamId] = useState<number | null>(null)
    const [filterTagIds, setFilterTagIds] = useState<number[]>([])
    const [filterDateFrom, setFilterDateFrom] = useState<string>('')
    const [filterDateTo, setFilterDateTo] = useState<string>('')
    const [agentsList, setAgentsList] = useState<{ id: number; name: string; email: string; avatar_url?: string | null }[]>([])

    // Chat state
    const [selectedChat, setSelectedChat] = useState<number | null>(null)
    const [input, setInput] = useState('')
    const [chatLoading, setChatLoading] = useState(false)
    const [resolving, setResolving] = useState(false)
    const joinedRef = useRef(false)
    const prevSelectedChatRef = useRef<number | null>(selectedChat)
    // Mirror of selectedChat used by the URL-sync effect to avoid oscillation.
    // See the comment on that effect for full explanation.
    const selectedChatRef = useRef<number | null>(selectedChat)
    useEffect(() => {
        selectedChatRef.current = selectedChat
    }, [selectedChat])
    const loadMessagesTokenRef = useRef(0)
    const chatLoadingTokenRef = useRef(0)
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

    // CC1: every enabled form for each website — a website can have any
    // number, so the composer's "#" menu lists all of them. Missing entries
    // mean "not fetched yet" (button stays hidden, same as an unresolved
    // /shortcut query showing nothing rather than erroring).
    const [formsByWebsiteId, setFormsByWebsiteId] = useState<Record<number, { id: number; name: string }[]>>({})
    const formsTokenRef = useRef(0)

    const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<number | null>(null)

    // Takeover confirmation (Smartsupp-like)
    const [showTakeoverConfirm, setShowTakeoverConfirm] = useState(false)
    const [pendingSendMessage, setPendingSendMessage] = useState<string | null>(null)

    // Offline warning (AV1): agent must confirm going online before sending/joining a chat
    const [showOfflineConfirm, setShowOfflineConfirm] = useState(false)
    const [pendingOfflineMessage, setPendingOfflineMessage] = useState<string | null>(null)
    const [goingOnline, setGoingOnline] = useState(false)
    const composerRef = useRef<ChatComposerHandle>(null)

    // CC1: sending the contact card is a conversation action like sending a
    // message — it must go through the same join-first / takeover-conflict /
    // offline-gate checks as handleSendMessage, just with a form id instead
    // of text content to stash and resend. Non-null tells
    // confirmTakeoverAndSend/confirmGoOnlineAndSend to resume with the
    // contact-card path (and which form) instead of the text-send path.
    const [pendingContactCardFormId, setPendingContactCardFormId] = useState<number | null>(null)

    // Conversation details state
    const [conversation, setConversation] = useState<ConversationDetails | null>(null)
    // Always-fresh read for WS handler closures (avoids stale-closure staleness
    // from the chat-specific effect's narrower dependency array).
    const conversationRef = useRef(conversation)
    useEffect(() => {
        conversationRef.current = conversation
    }, [conversation])
    const [notes, setNotes] = useState<Note[]>([])
    const [browsingHistory, setBrowsingHistory] = useState<any[]>([])
    const [conversationRating, setConversationRating] = useState<{ rating: number; feedback?: string } | null>(null)
    const [formSubmissions, setFormSubmissions] = useState<any[]>([])
    // Patches the one submission VisitorDetailsPanel's "Form submissions"
    // popup just saved an edit to, in place — the panel's edit state resets
    // once the popup closes, so without this a reopen would show the
    // pre-edit values again until the next full conversation-detail fetch.
    const handleFormSubmissionUpdated = useCallback((submissionId: number, data: Record<string, string>) => {
        setFormSubmissions((prev) => prev.map((s) => (s.id === submissionId ? { ...s, data } : s)))
    }, [])
    // Patches visitor_name/email/phone into conversation state (open panel,
    // chat list row, resolved list) wherever they're cached — shared by the
    // "agent typed a correction" path (onUpdateMetadata, which PATCHes the
    // conversation itself) and the "agent edited the contact-card form
    // submission" path (chats.py's form-submission PATCH already syncs
    // conversation.visitor_* server-side as a side effect, so that caller
    // only needs the local state applied, no second network round trip).
    const applyConversationContactUpdates = useCallback((updates: {
        visitor_name?: string | null
        visitor_email?: string | null
        visitor_phone?: string | null
    }) => {
        const convId = conversation?.id
        if (!convId) return
        setConversation((prev) => (prev ? ({ ...prev, ...updates } as any) : prev))
        setActiveChats(
            activeChatsRef.current.map((c) => (c.id === convId ? ({ ...(c as any), ...updates } as any) : c))
        )
        setResolvedChats((prev) =>
            (Array.isArray(prev) ? prev : []).map((c) => ((c as any).id === convId ? ({ ...(c as any), ...updates } as any) : c))
        )
    }, [conversation?.id])
    // Refetches the full list fresh — passed to VisitorDetailsPanel so its
    // "Form submissions" popup pulls current data on open instead of
    // whatever was loaded when the conversation was first opened, which can
    // be stale by the time an agent opens the popup minutes later.
    const refetchFormSubmissions = useCallback(() => {
        if (!selectedChat) return
        apiRequest<any[]>(`/chats/${selectedChat}/form-submissions`)
            .then((subs) => setFormSubmissions(Array.isArray(subs) ? subs : []))
            .catch(() => { })
    }, [selectedChat])
    // Bumped on a lead_delivery_updated WS event so VisitorDetailsPanel's
    // Lead delivery section refetches live — a delivery's status flips
    // asynchronously after the request that triggered it, so without this
    // agents only see it after switching conversations or reloading.
    const [leadStatusRefreshKey, setLeadStatusRefreshKey] = useState(0)
    const [availableTags, setAvailableTags] = useState<any[]>([])
    const [conversationTags, setConversationTags] = useState<any[]>([])
    const [visitorConversations, setVisitorConversations] = useState<VisitorConversation[]>([])

    const [availableTeams, setAvailableTeams] = useState<any[]>([])
    const [teamPickerOpen, setTeamPickerOpen] = useState(false)
    const [teamPickerQuery, setTeamPickerQuery] = useState('')

    const [tagPickerOpen, setTagPickerOpen] = useState(false)
    const [tagPickerQuery, setTagPickerQuery] = useState('')

    const [testNotifState, setTestNotifState] = useState<'idle' | 'loading' | 'sent' | 'no_sub' | 'error'>('idle')

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

    // Debounce search query for server-side resolved search (300ms)
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // Close mobile visitor details overlay when switching conversations
    useEffect(() => {
        setShowMobileDetails(false)
    }, [selectedChat])

    // Load chats list (show spinner only on first load)
    useEffect(() => {
        fetchActiveChats({ showSpinner: true })
    }, [])

    // Eagerly fetch resolved count so the sidebar badge is populated on page load
    // without requiring the user to click the Resolved tab first.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const { fetchResolvedCount } = await import('@/services/chats')
                const total = await fetchResolvedCount()
                if (!cancelled) setResolvedTotal(total)
            } catch { /* best-effort */ }
        })()
        return () => { cancelled = true }
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

    // Load agents list for advanced filters (admin-only — GET /users is restricted to admins).
    // Agents don't see the agent-filter dropdown so they never need this list.
    useEffect(() => {
        let cancelled = false
            ; (async () => {
                if (isAdmin(user)) {
                    try {
                        const data = await apiRequest<any[]>('/users')
                        if (!cancelled) setAgentsList(Array.isArray(data) ? data.map((u: any) => ({ id: u.id, name: u.name || u.email, email: u.email, avatar_url: u.avatar_url ?? null })) : [])
                    } catch {
                        if (!cancelled) setAgentsList([])
                    }
                }
                try {
                    const data = await apiRequest<any[]>('/teams/overview')
                    if (!cancelled) setAvailableTeams(
                        Array.isArray(data)
                            ? data.flatMap((w: any) => w.teams || [])
                            : []
                    )
                } catch {
                    // Teams will be loaded per-conversation as a fallback
                }
                try {
                    // Load any tags from any accessible website as filter options
                    // Tags are also derived from loaded chats below (allTagsFromChats)
                } catch { /* no-op */ }
            })()
        return () => { cancelled = true }
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

    // CC1: same fetch-on-website-change pattern as shortcuts above. Skips
    // re-fetching a website already resolved (including "confirmed none").
    useEffect(() => {
        if (!selectedWebsiteId) return
        if (Object.prototype.hasOwnProperty.call(formsByWebsiteId, selectedWebsiteId)) return

        const token = ++formsTokenRef.current
            ; (async () => {
                try {
                    const data = await apiRequest<{ id: number; name: string }[]>(`/websites/${selectedWebsiteId}/forms/for-agent`)
                    if (token !== formsTokenRef.current) return
                    setFormsByWebsiteId((prev) => ({ ...prev, [selectedWebsiteId]: data || [] }))
                } catch {
                    if (token !== formsTokenRef.current) return
                    setFormsByWebsiteId((prev) => ({ ...prev, [selectedWebsiteId]: [] }))
                }
            })()
    }, [selectedWebsiteId, formsByWebsiteId])

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

    const openVisitorConversation = useCallback((vc: VisitorConversation) => {
        const isResolved = (vc.status || '').toLowerCase() !== 'open'
        // Switch filter tab so the sidebar shows the right list
        setActiveFilter(isResolved ? 'resolved' : 'all')
        // Navigate directly using short_id we already have — no list injection needed
        navigate(`/dashboard/chats/${vc.short_id}`)
        openChat(vc.id)
    }, [navigate, openChat, setActiveFilter])

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
    const isVisitorEnded = Boolean(conversation && (conversation as any).visitor_ended)
    // Bot-only conversations have no human handoff by design — an agent
    // replying into one doesn't reach anyone real and just confuses the
    // automation's own state (e.g. mid-flow "Careers" IVR).
    const isBotOnlySelected = Boolean(conversation?.bot_only)

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
    // Always reset the filter to 'all' so the sidebar Chats link brings you to open conversations.
    useEffect(() => {
        if (!isChatsListRoute) {
            // Track the last known selectedChat value so we can detect transitions below.
            prevSelectedChatRef.current = selectedChat
            return
        }
        // Scenario A: user clicked a chat while already on the list route.
        // selectedChat just transitioned null → non-null; navigation to /dashboard/chats/:id
        // is pending in the sibling effect. Skip cleanup so the list doesn't flash to 'all'.
        const justSelected = prevSelectedChatRef.current === null && selectedChat !== null
        prevSelectedChatRef.current = selectedChat
        if (justSelected) return

        // Scenario B: user navigated TO /dashboard/chats from a conversation URL.
        // selectedChat is still non-null from the previous route — clear everything.
        setActiveFilter('all')
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

    // Ensure conversation details populate once chats load (handles refresh on deep links).
    // NOTE: We use a ref for getChatById so this effect only re-runs when selectedChat changes,
    // NOT every time activeChats/resolvedChats change. Previously, every fetchActiveChats() call
    // would trigger this effect and overwrite optimistic tag/team updates with stale cache data.
    const getChatByIdRef = useRef(getChatById)
    getChatByIdRef.current = getChatById
    useEffect(() => {
        if (selectedChat) {
            const chatData = getChatByIdRef.current(selectedChat)
            if (chatData) {
                setConversation(chatData as any)
            }
        }
    }, [selectedChat]) // intentionally omit getChatById — use ref to avoid stale rewrites

    // Handle conversation selection from URL.
    // Canonical URL is /dashboard/chats/:chatId where chatId is the conversation PK.
    //
    // NOTE: `selectedChat` is intentionally NOT in the dependency array — we read it via
    // `selectedChatRef` instead. When a user clicks a conversation in the "Other
    // conversations" panel, `openChat(id)` sets `selectedChat` immediately, but the URL
    // hasn't updated yet (Effect B's `navigate()` runs in the same flush, after this
    // effect). With `selectedChat` in the deps, this effect fired, saw that
    // `getPreferredConversationId()` (still reading the old URL) returned the old
    // conversation's ID, and called `openChat(oldId)` — reverting the click. That
    // triggered Effect B again → infinite oscillation / "page reload" symptom.
    // Using a ref breaks the cycle: the ref always holds the latest value but does not
    // cause this effect to re-run on programmatic selections.
    useEffect(() => {
        const preferredId = getPreferredConversationId()
        if (preferredId) {
            if (preferredId !== selectedChatRef.current) {
                openChat(preferredId)
                // Auto-switch the filter tab so the conversation is visible in the list,
                // but only when the filter actually needs to change to avoid spurious renders.
                const inResolved = resolvedChats.some((c: any) => c.id === preferredId)
                const targetFilter: FilterCategory = inResolved ? 'resolved' : 'all'
                if (activeFilter !== targetFilter) setActiveFilter(targetFilter)
            }
            return
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getPreferredConversationId, openChat, resolvedChats, activeFilter])

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
            ; (async () => {
                try {
                    const summary = await apiRequest<any>(`/chats/${chatIdParam}`, {
                        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
                    })
                    if (cancelled || !summary?.id) return
                    const isResolved = summary.status === 'resolved'
                    if (isResolved) {
                        setResolvedChats((prev: any[]) => {
                            const exists = prev.some((c) => c.id === summary.id)
                            return exists ? prev : [summary, ...prev]
                        })
                        setActiveFilter('resolved')
                    } else {
                        setActiveChats(sortChatsByActivity([{ ...summary, current_agent_id: summary.assigned_agent_id }, ...activeChats]))
                        setActiveFilter('all')
                    }
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
                setResolvedRefreshCounter(prev => prev + 1)
            } else if (data.type === 'new_conversation') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'connected') {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'visitor_closed_chat' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'visitor_dropped' && dataConversationId) {
                fetchActiveChats({ showSpinner: false })
            } else if (data.type === 'system_message' && dataConversationId) {
                const eventType = (data as any)?.message_obj?.event_type || (data as any)?.event_type
                if (eventType === 'visitor_left') {
                    // Mark this conversation as visitor-ended in the active list
                    const latest = activeChatsRef.current
                    const idx = latest.findIndex(c => c.id === dataConversationId)
                    if (idx >= 0) {
                        const next = [...latest]
                        next[idx] = { ...next[idx], visitor_ended: true }
                        setActiveChats(next)
                    }
                } else {
                    fetchActiveChats({ showSpinner: false })
                }
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
                        setActiveChats(sortChatsByActivity(next))
                    }
                }
            } else if (data.type === 'agent_message' && dataConversationId) {
                // Update list preview when the assigned agent sends a message (spectator path).
                // The chat-specific handler only fires for the selected conversation, so this
                // global handler ensures the list stays current even when another chat is open.
                const dto = (data as any)?.message_obj
                const content = dto && typeof dto === 'object' ? String((dto as any)?.content ?? '').trim() : ''
                const ts = (dto && typeof dto === 'object'
                    ? ((dto as any)?.timestamp || (dto as any)?.created_at)
                    : null) || new Date().toISOString()
                if (content) {
                    const latest = activeChatsRef.current
                    const idx = latest.findIndex(c => c.id === dataConversationId)
                    if (idx >= 0) {
                        const next = [...latest]
                        next[idx] = { ...next[idx], last_message: content, last_message_at: ts }
                        setActiveChats(sortChatsByActivity(next))
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
            } else if (data.type === 'contact_card_submitted' && dataConversationId) {
                // CC1: keeps the chat list's visitor name current even when
                // this conversation isn't the one currently open.
                const visitorName = (data as any)?.visitor_name
                if (visitorName) {
                    const latest = activeChatsRef.current
                    const idx = latest.findIndex(c => c.id === dataConversationId)
                    if (idx >= 0 && latest[idx].visitor_name !== visitorName) {
                        const next = [...latest]
                        next[idx] = { ...next[idx], visitor_name: visitorName }
                        setActiveChats(next)
                    }
                }
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
                            setActiveChats(sortChatsByActivity(next))
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
                            setActiveChats(sortChatsByActivity(next))
                        }
                    }
                } else {
                    loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                }
            } else if (data.type === 'conversation_assigned' && dataConversationId === selectedChat) {
                // Keep joinedRef in sync: if someone else took over, we are no longer the handler.
                const newAssignedId = Number((data as any)?.assigned_agent_id) || null
                joinedRef.current = newAssignedId !== null && newAssignedId === user?.id
            } else if (data.type === 'conversation_team_changed' && dataConversationId === selectedChat) {
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'conversation_closed' && dataConversationId === selectedChat) {
                setSelectedChat(null)
                navigate('/dashboard/chats')
            } else if (data.type === 'visitor_closed_chat' && dataConversationId === selectedChat) {
                setConversation(prev => prev ? { ...prev, visitor_ended: true } as any : prev)
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'visitor_session_presence' && String((data as any)?.session_id || '') === conversationRef.current?.session_id) {
                // Same signal the Customers -> Visitors page uses: fires on every
                // connect/disconnect regardless of engagement, unlike the
                // visitor_dropped/visitor_reconnected timeline events (which only
                // fire once the visitor has sent a message or clicked a button).
                // Matches against the ref (not the closed-over `conversation`) so
                // this can't miss due to the effect's closure being stale.
                const isNowOnline = Boolean((data as any)?.is_online)
                const disconnectedAt = (data as any)?.last_disconnected_at
                setConversation(prev => prev ? {
                    ...prev,
                    is_online: isNowOnline,
                    // Update last_seen_at live so the header doesn't need a reload
                    // to reflect it: use the server's timestamp when given (offline
                    // transition), otherwise "now" for the online transition.
                    last_seen_at: isNowOnline ? new Date().toISOString() : (disconnectedAt || new Date().toISOString()),
                } as any : prev)
            } else if (data.type === 'system_message' && dataConversationId === selectedChat) {
                const eventType = (data as any)?.message_obj?.event_type || (data as any)?.event_type
                if (eventType === 'visitor_left') {
                    const latest = activeChatsRef.current
                    const idx = latest.findIndex(c => c.id === dataConversationId)
                    if (idx >= 0) {
                        const next = [...latest]
                        next[idx] = { ...next[idx], visitor_ended: true }
                        setActiveChats(next)
                    }
                    setConversation(prev => prev ? { ...prev, visitor_ended: true } as any : prev)
                }
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'visitor_socket_connected' && dataConversationId === selectedChat) {
                setConversation(prev => prev ? { ...prev, is_online: true } as any : prev)
                loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
            } else if (data.type === 'visitor_rated' && dataConversationId === selectedChat) {
                const ratingVal = (data as any)?.rating
                if (typeof ratingVal === 'number') {
                    setConversationRating({ rating: ratingVal })
                }
            } else if (data.type === 'contact_card_submitted' && dataConversationId === selectedChat) {
                // CC1: flips the specific card to "filled" and refreshes the
                // sidebar/header live — submit_form is a REST call from the
                // widget, so without this the agent only sees it on reload.
                const msgId = (data as any)?.message_id
                const submittedData = (data as any)?.data
                if (msgId != null) {
                    patchMessage(msgId, { contact_card_state: { status: 'filled', data: submittedData } })
                }
                // Full server resync rather than patching just the 3 fields from
                // the WS payload in place — a contact-card submission can also
                // be the trigger for a lead_delivered automation tagging the
                // conversation moments later, and the old inline patch never
                // touched activeChats, so the chat-list row's name/tags could
                // still drift stale even though the open panel looked right.
                refreshConversationFromServer(dataConversationId)
                // CC1: the visitor-details panel's "Form submissions" list is
                // fetched once when the conversation is opened and otherwise
                // never refreshed — without this, a new submission (or a
                // field the form gained after that fetch, e.g. "location")
                // only shows up after switching conversations or reloading.
                refetchFormSubmissions()
                // A newly-submitted form can also change the "N forms" count
                // shown on an awaiting-confirmation delivery in the Lead
                // delivery section — without this it only updates after
                // switching conversations or reloading.
                setLeadStatusRefreshKey((k) => k + 1)
            } else if (data.type === 'lead_delivery_updated' && dataConversationId === selectedChat) {
                // A delivery just flipped to sent/failed (or a lead_delivered
                // automation just tagged the conversation) asynchronously,
                // outside any request this tab made — refresh both the Lead
                // delivery section and the conversation's tags live.
                // (loadChatData only refetches the message thread, not the
                // conversation/tags — that's a no-op for what we need here.)
                setLeadStatusRefreshKey((k) => k + 1)
                refreshConversationFromServer(selectedChat)
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
                    supersedeOlderContactCards(dto)
                    const content = String((dto as any)?.content ?? '').trim()
                    const ts = (dto as any)?.timestamp || (dto as any)?.created_at || new Date().toISOString()
                    if (content) {
                        const latest = activeChatsRef.current
                        const idx = latest.findIndex(c => c.id === dataConversationId)
                        if (idx >= 0) {
                            const next = [...latest]
                            next[idx] = { ...next[idx], last_message: content, last_message_at: ts }
                            setActiveChats(sortChatsByActivity(next))
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
            } else if (data.type === 'bot_message' && dataConversationId === selectedChat) {
                // Bot messages from automation flows (waiting message, visitor ended hint, etc.)
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
            setActiveChats(sortChatsByActivity(chats as any[]))
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
            chatLoadingTokenRef.current = token
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
            if (showSpinner && chatLoadingTokenRef.current === token) {
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

    // Unlike loadConversationDetails, this always hits the server rather than
    // preferring the locally-cached activeChats/resolvedChats entry — needed
    // for server-side changes that happen outside any request this tab made
    // (an automation tagging the conversation, visitor_* fields backfilled by
    // a form submission), where the local cache is exactly what's stale.
    const refreshConversationFromServer = useCallback(async (chatId: number) => {
        try {
            const summary = await fetchChatSummary(chatId)
            setConversation((prev) => (prev && (prev as any).id === chatId ? ({ ...prev, ...summary } as any) : (summary as any)))
            setConversationTags(((summary as any)?.tags || []) as any)
            const patch = (list: any[]) => list.map((c) => (c.id === chatId ? { ...c, ...summary } : c))
            setActiveChats(patch(activeChats))
            setResolvedChats((prev) => patch(prev))
        } catch {
            // best-effort — a later reload or the normal poll cycle will catch up
        }
    }, [activeChats, setActiveChats])

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
                            setActiveChats(sortChatsByActivity([summary as any, ...activeChats]))
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

            // Fetch form submissions for this conversation (best-effort).
            apiRequest<any[]>(`/chats/${chatId}/form-submissions`)
                .then((data) => {
                    if (loadDetailsTokenRef.current === token) {
                        setFormSubmissions(Array.isArray(data) ? data : [])
                    }
                })
                .catch(() => {
                    if (loadDetailsTokenRef.current === token) setFormSubmissions([])
                })

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
            // Update both activeChats and resolvedChats so getChatById returns fresh data
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat
                    ? { ...c, tags: [...((c as any).tags || []).filter((t: any) => Number(t?.id) !== tagId), tag] }
                    : c
            ))
            setResolvedChats((prev: any[]) =>
                (Array.isArray(prev) ? prev : []).map((c: any) =>
                    c.id === selectedChat
                        ? { ...c, tags: [...((c.tags || []).filter((t: any) => Number(t?.id) !== tagId)), tag] }
                        : c
                )
            )
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
            // Update both activeChats and resolvedChats
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat
                    ? { ...c, tags: ((c as any).tags || []).filter((t: any) => Number(t?.id) !== tagId) }
                    : c
            ))
            setResolvedChats((prev: any[]) =>
                (Array.isArray(prev) ? prev : []).map((c: any) =>
                    c.id === selectedChat
                        ? { ...c, tags: ((c.tags || []).filter((t: any) => Number(t?.id) !== tagId)) }
                        : c
                )
            )
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

            // Update both lists so getChatById returns fresh data (prevents the stale-ref
            // useEffect from re-reading the old team_id and overwriting the optimistic update)
            setActiveChats(activeChats.map(c =>
                c.id === selectedChat ? { ...c, team_id: teamId } as any : c
            ))
            setResolvedChats((prev: any[]) =>
                (Array.isArray(prev) ? prev : []).map((c: any) =>
                    c.id === selectedChat ? { ...c, team_id: teamId } : c
                )
            )

            // Re-fetch from server so visibility / team-scope filtering is applied
            await fetchActiveChats({ showSpinner: false })
        } catch (error) {
            console.error('Failed to set team:', error)
        }
    }

    // Returns whether the message actually went out. `false` tells ChatComposer
    // (via its onSend contract) to keep the drafted text instead of clearing it —
    // used when the send is blocked by the offline gate or a takeover race.
    const handleSendMessage = async (overrideContent?: string): Promise<boolean> => {
        const raw = typeof overrideContent === 'string' ? overrideContent : input
        if (!raw.trim() || !selectedChat) return false
        if (isResolvedSelected || isBotOnlySelected) return false

        // AV1: block the send and ask the agent to go online first, instead of
        // silently flipping their availability server-side. Reads the store
        // directly (not the `user` closure) so the recursive call from
        // confirmGoOnlineAndSend sees the just-updated is_available immediately,
        // rather than a stale value from this render.
        const currentUserForGate = useAppStore.getState().user
        if (currentUserForGate && currentUserForGate.is_available === false) {
            setPendingOfflineMessage(raw.trim())
            setShowOfflineConfirm(true)
            return false
        }

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
                        return false
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
                    setActiveChats(sortChatsByActivity(next))
                }
            } catch {
                // ignore
            }

            return true
        } catch (error) {
            console.error("Failed to send message:", error)
            // Note: intentionally do not restore into `input` — ChatComposer owns
            // its own draft text and, since we return false here, never cleared it.
            return false
        }
    }

    // CC1: same join-first / takeover-conflict / offline-gate rules as
    // handleSendMessage above — sending the contact card is a conversation
    // action, not a passive read, so it must claim the conversation exactly
    // like a first reply does instead of 400ing when nobody's joined yet.
    const handleSendContactCard = async (formId: number): Promise<void> => {
        if (!selectedChat) return
        if (isResolvedSelected || isBotOnlySelected) return

        const currentUserForGate = useAppStore.getState().user
        if (currentUserForGate && currentUserForGate.is_available === false) {
            setPendingContactCardFormId(formId)
            setShowOfflineConfirm(true)
            return
        }

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

                    if (joinResult?.message_obj) {
                        addMessage(joinResult.message_obj)
                    } else {
                        loadChatData(selectedChat, { showSpinner: false, preserveMessages: true })
                    }
                } catch (e: any) {
                    const msg = String(e?.message || '')
                    if (msg.toLowerCase().includes('already assigned') || msg.toLowerCase().includes('already')) {
                        setPendingContactCardFormId(formId)
                        setShowTakeoverConfirm(true)
                        return
                    }
                    throw e
                }
            }

            const sendResult: any = await sendContactCard(selectedChat, formId)
            // The backend broadcast excludes the sending agent (same pattern
            // as a regular message, which gets its own confirmation via the
            // agent WS's message_sent event) — but this is a REST call, so
            // there's no equivalent push back to *this* dashboard. Add it
            // client-side, same as the join/takeover results just above.
            if (sendResult?.message_obj) {
                addMessage(sendResult.message_obj)
                supersedeOlderContactCards(sendResult.message_obj)
            }
        } catch (error) {
            console.error('Failed to send contact card:', error)
        }
    }

    const confirmTakeoverAndSend = async (confirm: boolean) => {
        if (pendingContactCardFormId != null) {
            const formId = pendingContactCardFormId
            setShowTakeoverConfirm(false)
            setPendingContactCardFormId(null)
            if (!confirm || !selectedChat) return
            if (isResolvedSelected || isBotOnlySelected) return
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
                const sendResult: any = await sendContactCard(selectedChat, formId)
                if (sendResult?.message_obj) {
                    addMessage(sendResult.message_obj)
                }
            } catch (error) {
                console.error('Failed to takeover and send contact card:', error)
            }
            return
        }

        const content = pendingSendMessage
        setShowTakeoverConfirm(false)
        setPendingSendMessage(null)

        // On cancel, do nothing to the composer — it never cleared its draft
        // since handleSendMessage returned false before this modal opened.
        if (!confirm) return

        if (!selectedChat || !content) return
        if (isResolvedSelected || isBotOnlySelected) return

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
            const clientId = sendAgentMessage(content, selectedChat.toString())

            // Optimistic UI — show the message immediately, same as handleSendMessage.
            const optimisticCreatedAt = new Date().toISOString()
            addMessage({
                id: `tmp:${clientId}`,
                conversation_id: selectedChat,
                sender_type: 'agent',
                actor: 'agent',
                kind: 'chat',
                content: content,
                created_at: optimisticCreatedAt,
                sender_name: user?.name || undefined,
                sender_avatar_url: (user as any)?.avatar_url || undefined,
            } as any)

            // The composer held onto its draft since the original onSend call
            // returned false (takeover race) — now that it's actually sent, clear it.
            composerRef.current?.clear()
        } catch (error) {
            console.error('Failed to takeover and send:', error)
        }
    }

    // AV1: agent confirmed (or cancelled) going online from the offline-warning popup.
    const confirmGoOnlineAndSend = async (confirm: boolean) => {
        const content = pendingOfflineMessage
        const wasContactCardFormId = pendingContactCardFormId
        setShowOfflineConfirm(false)
        setPendingOfflineMessage(null)
        setPendingContactCardFormId(null)

        // On cancel, do nothing to the composer — it never cleared its draft
        // since handleSendMessage returned false before this modal opened.
        if (!confirm) return

        if (!content && wasContactCardFormId == null) return

        setGoingOnline(true)
        try {
            const response = await updateAvailability(true)
            const current = useAppStore.getState().user
            if (current) {
                setUser({ ...current, is_available: response.is_available })
            }
            // Re-run the send now that the agent is online; the top-of-function
            // offline check will pass since is_available is now true.
            if (wasContactCardFormId != null) {
                await handleSendContactCard(wasContactCardFormId)
            } else if (content) {
                const sent = await handleSendMessage(content)
                if (sent) composerRef.current?.clear()
            }
        } catch (error) {
            console.error('Failed to go online:', error)
        } finally {
            setGoingOnline(false)
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
                    const data = await fetchClosedConversations(
                        filterWebsiteId ?? undefined,
                        filterAgentId ?? undefined,
                        50, 0, resolvedServerFilters,
                    )
                    setResolvedChats(data as any)
                    setResolvedOffset(0)
                    setResolvedHasMore((data as any[]).length === 50)
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

    const handleTestNotification = async () => {
        if (testNotifState === 'loading') return
        setTestNotifState('loading')
        try {
            const res = await testPushNotification()
            if (res.attempted > 0) {
                setTestNotifState('sent')
            } else {
                setTestNotifState('no_sub')
            }
        } catch {
            setTestNotifState('error')
        }
        setTimeout(() => setTestNotifState('idle'), 4000)
    }

    const chatsForList = activeFilter === 'resolved'
        ? (Array.isArray(resolvedChats) ? resolvedChats : [])
        : activeChats

    const _filteredChatsRaw = activeFilter === 'resolved'
        // Resolved: filtering is server-side, results are already correct
        ? chatsForList
        : chatsForList.filter(chat => {
            // Search: name, email, phone, short_id, title, session_id, last_message
            if (searchQuery) {
                const q = searchQuery.toLowerCase().trim()
                const fields = [
                    String((chat as any).visitor_name || ''),
                    String((chat as any).visitor_email || ''),
                    String((chat as any).visitor_phone || ''),
                    String((chat as any).short_id || ''),
                    String((chat as any).title || ''),
                    String(chat.session_id || ''),
                    String((chat as any).last_message || ''),
                ]
                if (!fields.some(f => f.toLowerCase().includes(q))) return false
            }

            // Advanced filters
            if (filterWebsiteId && (chat as any).website_id !== filterWebsiteId) return false
            if (filterAgentId && (chat as any).assigned_agent_id !== filterAgentId) return false
            if (filterTeamId && (chat as any).team_id !== filterTeamId) return false
            if (filterTagIds.length > 0) {
                const chatTagIds = ((chat as any).tags || []).map((t: any) => Number(t?.id))
                if (!filterTagIds.every(id => chatTagIds.includes(id))) return false
            }
            if (filterDateFrom || filterDateTo) {
                const ts = new Date((chat as any).created_at || '').getTime()
                if (Number.isFinite(ts)) {
                    if (filterDateFrom && ts < new Date(filterDateFrom).getTime()) return false
                    if (filterDateTo && ts > new Date(filterDateTo).getTime()) return false
                }
            }

            // Category filter
            switch (activeFilter) {
                case 'all':
                    return chat.status === 'open' && !(chat as any).bot_only
                case 'mine':
                    return chat.status === 'open' && !(chat as any).bot_only && (chat as any).assigned_agent_id === user?.id
                case 'unassigned':
                    return chat.status === 'open' && !(chat as any).bot_only && (chat as any).assigned_agent_id == null
                case 'bot':
                    return chat.status === 'open' && (chat as any).bot_only === true
                default:
                    return chat.status === 'open' && !(chat as any).bot_only
            }
        })

    // Deduplicate by id to guard against any state bleed or Load More overlap
    const filteredChats = (() => {
        const seen = new Set<number>()
        return _filteredChatsRaw.filter((chat: any) => {
            const id = Number(chat.id)
            if (seen.has(id)) return false
            seen.add(id)
            return true
        })
    })()

    const hasAdvancedFilters = !!(filterWebsiteId || filterAgentId || filterTeamId || filterTagIds.length > 0 || filterDateFrom || filterDateTo)

    // Distinct website options from loaded chats (for filter dropdown)
    const websiteOptions = useMemo(() => {
        const seen = new Map<number, string>()
        for (const c of [...activeChats, ...resolvedChats]) {
            const id = (c as any).website_id
            const name = (c as any).website_name || `Website ${id}`
            if (id && !seen.has(id)) seen.set(id, name)
        }
        return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
    }, [activeChats, resolvedChats])

    // Unique tags derived from loaded chats (supplements availableTags)
    const allTagsFromChats = useMemo(() => {
        const seen = new Map<number, { id: number; name: string; color: string }>()
        for (const c of [...activeChats, ...resolvedChats]) {
            for (const tag of ((c as any).tags || [])) {
                if (tag?.id && !seen.has(Number(tag.id))) seen.set(Number(tag.id), tag)
            }
        }
        // Merge with availableTags (loaded per-conversation)
        for (const tag of availableTags) {
            if (tag?.id && !seen.has(Number(tag.id))) seen.set(Number(tag.id), tag)
        }
        return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
    }, [activeChats, resolvedChats, availableTags])

    // Server-side filters for resolved list — use debouncedSearchQuery to avoid per-keystroke API requests
    const resolvedServerFilters = activeFilter === 'resolved' ? {
        search: debouncedSearchQuery || undefined,
        teamId: filterTeamId ?? undefined,
        tagIds: filterTagIds.length ? filterTagIds : undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
    } : undefined

    // Stable key representing the current resolved filter state.
    // Used to detect genuine filter changes vs transient activeFilter bounces
    // (e.g. 'resolved' → 'all' → 'resolved' that happens when clicking a chat).
    const resolvedFetchKeyRef = useRef<string>('')
    const resolvedChatsLoadedRef = useRef(false)

    useEffect(() => {
        if (activeFilter !== 'resolved') return

        const newKey = [debouncedSearchQuery, filterWebsiteId, filterAgentId, filterTeamId, filterTagIds.join(','), filterDateFrom, filterDateTo, resolvedRefreshCounter].join('|')

        // Same filter params and we already have data — activeFilter bounced back, skip reset
        if (resolvedFetchKeyRef.current === newKey && resolvedChatsLoadedRef.current) return

        resolvedFetchKeyRef.current = newKey
        resolvedChatsLoadedRef.current = false

        let cancelled = false
        const load = async () => {
            try {
                setResolvedLoading(true)
                const { fetchClosedConversations, fetchResolvedCount } = await import('@/services/chats')
                const [data, total] = await Promise.all([
                    fetchClosedConversations(
                        filterWebsiteId ?? undefined,
                        filterAgentId ?? undefined,
                        50, 0,
                        resolvedServerFilters,
                    ),
                    fetchResolvedCount({
                        websiteId: filterWebsiteId ?? undefined,
                        agentId: filterAgentId ?? undefined,
                        search: debouncedSearchQuery || undefined,
                        teamId: filterTeamId ?? undefined,
                        tagIds: filterTagIds.length ? filterTagIds : undefined,
                        dateFrom: filterDateFrom || undefined,
                        dateTo: filterDateTo || undefined,
                    }),
                ])
                if (!cancelled) {
                    setResolvedChats(Array.isArray(data) ? (data as any) : [])
                    setResolvedOffset(0)
                    setResolvedHasMore((data as any[]).length === 50)
                    setResolvedTotal(total)
                    resolvedChatsLoadedRef.current = true
                }
            } catch (e) {
                console.error('Failed to load resolved conversations:', e)
                if (!cancelled) setResolvedChats([])
            } finally {
                if (!cancelled) setResolvedLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [activeFilter, debouncedSearchQuery, filterWebsiteId, filterAgentId, filterTeamId, filterTagIds, filterDateFrom, filterDateTo, resolvedRefreshCounter])

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
                            {pendingContactCardFormId != null
                                ? "If you send the contact card, you'll join the chat. Are you sure you want to send it?"
                                : "If you send the message, you'll join the chat. Are you sure you want to send the message?"}
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
            {showOfflineConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => confirmGoOnlineAndSend(false)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">You're offline</h3>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                            {pendingContactCardFormId != null
                                ? "Please go online to join this chat. The contact card won't be sent until you're available."
                                : "Please go online to join or reply to this chat. Your message won't be sent until you're available."}
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => confirmGoOnlineAndSend(false)}
                                disabled={goingOnline}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => confirmGoOnlineAndSend(true)}
                                disabled={goingOnline}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {goingOnline && <Loader2 className="w-4 h-4 animate-spin" />}
                                Go online & send
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* COLUMN 1: Filter/Category Sidebar */}
            <div className={`hidden lg:flex bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${leftFilterCollapsed ? 'w-16' : 'w-48'}`}
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
                                                <MessageCircle className="h-4 w-4 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open' && !(c as any).bot_only).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <MessageCircle className="h-4 w-4 flex-shrink-0" />
                                                    <span className="flex-1 text-left text-sm">All</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open' && !(c as any).bot_only).length}
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
                                                <Users className="h-4 w-4 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open' && !(c as any).bot_only && (c as any).assigned_agent_id === user?.id).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Users className="h-4 w-4 flex-shrink-0" />
                                                    <span className="flex-1 text-left text-sm">Mine</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open' && !(c as any).bot_only && (c as any).assigned_agent_id === user?.id).length}
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
                                                <Inbox className="h-4 w-4 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open' && !(c as any).bot_only && (c as any).assigned_agent_id == null).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Inbox className="h-4 w-4 flex-shrink-0" />
                                                    <span className="flex-1 text-left text-sm">Unassigned</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open' && !(c as any).bot_only && (c as any).assigned_agent_id == null).length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">Unassigned</TooltipContent>}
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setActiveFilter('bot')}
                                        className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${activeFilter === 'bot'
                                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {leftFilterCollapsed ? (
                                            <>
                                                <Bot className="h-4 w-4 flex-shrink-0" />
                                                <span className="text-xs font-semibold">{activeChats.filter(c => c.status === 'open' && (c as any).bot_only === true).length}</span>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Bot className="h-4 w-4 flex-shrink-0" />
                                                    <span className="flex-1 text-left text-sm">Bot</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {activeChats.filter(c => c.status === 'open' && (c as any).bot_only === true).length}
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                {leftFilterCollapsed && <TooltipContent side="right">Bot</TooltipContent>}
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
                                            <div className='flex flex-col w-full items-center'>
                                                <Check className="h-4 w-4 flex-shrink-0" />
                                                <span className="text-xs font-semibold">
                                                    {resolvedTotal === null ? '…' : resolvedTotal >= 100 ? '100+' : resolvedTotal}
                                                </span>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <Check className="h-4 w-4 flex-shrink-0" />
                                                    <span className="flex-1 text-left text-sm">Resolved</span>
                                                </div>
                                                <Badge variant="secondary" className="ml-auto">
                                                    {resolvedTotal === null ? '…' : resolvedTotal >= 100 ? '100+' : resolvedTotal}
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
            <div className={`${selectedChat !== null ? 'hidden md:flex' : 'flex'} flex-col flex-shrink-0 w-full md:w-72 lg:w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700`}>
                {/* Header */}
                <div>
                    <div className='h-16 p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between'>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            {getFilterIcon()}
                            {getFilterHeaderText()}
                            <DocsLink slug="agent-guide/conversations" />
                        </h2>
                    </div>

                    {/* Search + Filter button */}
                    <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search name, email, ID…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-8 dark:bg-gray-700 dark:border-gray-600"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setFilterPanelOpen(v => !v)}
                                        className={`relative flex-shrink-0 p-2 rounded-lg border transition-colors ${filterPanelOpen || hasAdvancedFilters
                                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400'
                                            : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        <SlidersHorizontal className="h-4 w-4" />
                                        {hasAdvancedFilters && (
                                            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-blue-600 border-2 border-white dark:border-gray-800" />
                                        )}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Advanced Filters</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    {/* Advanced filter panel */}
                    {filterPanelOpen && (
                        <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 space-y-3">
                            {/* Website */}
                            <div>
                                <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 mb-1">
                                    <Globe className="h-3 w-3" /> Website
                                </label>
                                <select
                                    value={filterWebsiteId ?? ''}
                                    onChange={e => setFilterWebsiteId(e.target.value ? Number(e.target.value) : null)}
                                    className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                >
                                    <option value="">All websites</option>
                                    {websiteOptions.map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                            </div>
                            {/* Agent */}
                            <div>
                                <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 mb-1">
                                    <UserRound className="h-3 w-3" /> Agent
                                </label>
                                <select
                                    value={filterAgentId ?? ''}
                                    onChange={e => setFilterAgentId(e.target.value ? Number(e.target.value) : null)}
                                    className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                >
                                    <option value="">All agents</option>
                                    {agentsList.map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </select>
                            </div>
                            {/* Team */}
                            {availableTeams.length > 0 && (
                                <div>
                                    <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 mb-1">
                                        <Users className="h-3 w-3" /> Team
                                    </label>
                                    <select
                                        value={filterTeamId ?? ''}
                                        onChange={e => setFilterTeamId(e.target.value ? Number(e.target.value) : null)}
                                        className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                    >
                                        <option value="">All teams</option>
                                        {availableTeams.map((t: any) => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {/* Tags */}
                            {allTagsFromChats.length > 0 && (
                                <div>
                                    <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 mb-1">
                                        <TagIcon className="h-3 w-3" /> Tags
                                    </label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {allTagsFromChats.map((tag: any) => {
                                            const active = filterTagIds.includes(Number(tag.id))
                                            return (
                                                <button
                                                    key={tag.id}
                                                    onClick={() => setFilterTagIds(prev =>
                                                        active ? prev.filter(id => id !== Number(tag.id)) : [...prev, Number(tag.id)]
                                                    )}
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${active
                                                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                        }`}
                                                >
                                                    {tag.color && (
                                                        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                                                    )}
                                                    {tag.name}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                            {/* Clear all */}
                            {/* Date range */}
                            <div>
                                <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 mb-1">
                                    <Calendar className="h-3 w-3" /> Date range (created)
                                </label>
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-gray-400 w-6 flex-shrink-0">From</span>
                                        <input
                                            type="datetime-local"
                                            value={filterDateFrom}
                                            onChange={e => setFilterDateFrom(e.target.value)}
                                            className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-gray-400 w-6 flex-shrink-0">To</span>
                                        <input
                                            type="datetime-local"
                                            value={filterDateTo}
                                            onChange={e => setFilterDateTo(e.target.value)}
                                            className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                        />
                                    </div>
                                </div>
                            </div>
                            {hasAdvancedFilters && (
                                <button
                                    onClick={() => {
                                        setFilterWebsiteId(null)
                                        setFilterAgentId(null)
                                        setFilterTeamId(null)
                                        setFilterTagIds([])
                                        setFilterDateFrom('')
                                        setFilterDateTo('')
                                    }}
                                    className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                                >
                                    Clear all filters
                                </button>
                            )}
                        </div>
                    )}

                    {/* Filter tabs — visible below lg (when Col1 sidebar is hidden) */}
                    <div className="lg:hidden flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
                        {([
                            { key: 'all' as FilterCategory, label: 'All', count: activeChats.filter(c => c.status === 'open' && !(c as any).bot_only).length },
                            { key: 'mine' as FilterCategory, label: 'Mine', count: activeChats.filter(c => c.status === 'open' && !(c as any).bot_only && (c as any).assigned_agent_id === user?.id).length },
                            { key: 'unassigned' as FilterCategory, label: 'Unassigned', count: activeChats.filter(c => c.status === 'open' && !(c as any).bot_only && (c as any).assigned_agent_id == null).length },
                            { key: 'bot' as FilterCategory, label: 'Bot', count: activeChats.filter(c => c.status === 'open' && (c as any).bot_only === true).length },
                            { key: 'resolved' as FilterCategory, label: 'Resolved', count: resolvedTotal === null ? 0 : resolvedTotal >= 100 ? -1 : resolvedTotal },
                        ]).map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveFilter(tab.key)}
                                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${activeFilter === tab.key
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                            >
                                {tab.label}
                                <span className={`inline-flex items-center justify-center min-w-[16px] h-4 rounded-full text-[10px] font-semibold px-1 ${activeFilter === tab.key ? 'bg-white/25 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                                    }`}>{tab.count === -1 ? '100+' : tab.count}</span>
                            </button>
                        ))}
                    </div>

                    <p className="text-sm text-gray-500 dark:text-gray-400 px-4 py-2">
                        {activeFilter === 'resolved' && resolvedTotal !== null
                            ? `${resolvedChats.length} of ${resolvedTotal} conversation${resolvedTotal !== 1 ? 's' : ''}`
                            : `${filteredChats.length} conversation${filteredChats.length !== 1 ? 's' : ''}`}
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
                                    className={`w-full text-left px-3 py-2.5 transition-colors ${selectedChat === chat.id ? 'bg-blue-50 dark:bg-blue-900/20 [box-shadow:inset_4px_0_0_#2563eb]' : 'hover:bg-gray-50 dark:hover:bg-gray-700 hover:[box-shadow:inset_4px_0_0_#d1d5db] dark:hover:[box-shadow:inset_4px_0_0_#4b5563]'}`}
                                >
                                    <div className="flex items-start gap-2.5">
                                        {/* Visitor avatar with assigned-agent badge */}
                                        <div className="relative flex-shrink-0">
                                            <UserAvatar
                                                seed={getVisitorAvatarSeed((chat as any).visitor_name, chat.session_id)}
                                                bgColor={(chat as any).visitor_avatar_color}
                                                className="w-9 h-9"
                                                iconClassName="w-9 h-9"
                                                title={conversationDisplayName(chat as any)}
                                            />
                                            <HandlerBadge
                                                botOnly={(chat as any).bot_only}
                                                assignedAgentId={(chat as any).assigned_agent_id}
                                                agent={(chat as any).assigned_agent}
                                            />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            {/* Row 1: name + website + time */}
                                            <div className="flex items-baseline justify-between gap-1 min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                                                    <span className="text-[14px] font-semibold text-gray-900 dark:text-white truncate leading-tight shrink">
                                                        {conversationDisplayName(chat as any)}
                                                    </span>
                                                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] max-w-28 truncate rounded shrink-0">
                                                        {(chat as any).website_name || `Site #${(chat as any).website_id}`}
                                                    </Badge>
                                                </div>
                                                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 leading-tight">
                                                    {formatShortAge((chat as any).last_message_at || (chat as any).created_at)}
                                                </span>
                                            </div>

                                            {/* Row 2: last message + unread badge */}
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                {(chat as any).last_message && (
                                                    <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate mt-0.5 leading-tight">
                                                        {stripMarkdownPreview((chat as any).last_message)}
                                                    </p>
                                                )}
                                                {chat.id !== selectedChat && Boolean(unreadByConversationId[chat.id]) && (
                                                    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] flex-shrink-0 ml-auto">
                                                        {unreadByConversationId[chat.id] > 99 ? '99+' : unreadByConversationId[chat.id]}
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* Row 3: tags */}
                                            {((chat as any).tags || []).length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {((chat as any).tags as any[]).slice(0, 3).map((tag: any) => (
                                                        <span
                                                            key={tag.id}
                                                            className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium rounded-full border leading-none"
                                                            style={{
                                                                backgroundColor: getTagPillBackground(tag.color),
                                                                borderColor: tag.color || '#d1d5db',
                                                                color: tag.color || 'inherit',
                                                            }}
                                                        >
                                                            {tag.name}
                                                        </span>
                                                    ))}
                                                    {((chat as any).tags as any[]).length > 3 && (
                                                        <span className="text-[9px] text-gray-400">+{((chat as any).tags as any[]).length - 3}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    {activeFilter === 'resolved' && resolvedHasMore && (
                        <div className="p-3 text-center border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={async () => {
                                    const nextOffset = resolvedOffset + 50
                                    setResolvedLoadingMore(true)
                                    try {
                                        const { fetchClosedConversations } = await import('@/services/chats')
                                        const data = await fetchClosedConversations(
                                            filterWebsiteId ?? undefined,
                                            filterAgentId ?? undefined,
                                            50, nextOffset,
                                            resolvedServerFilters,
                                        )
                                        setResolvedChats(prev => {
                                            const existingIds = new Set(prev.map((c: any) => c.id))
                                            const fresh = (data as any[]).filter((c: any) => !existingIds.has(c.id))
                                            return [...prev, ...fresh]
                                        })
                                        setResolvedOffset(nextOffset)
                                        setResolvedHasMore((data as any[]).length === 50)
                                    } catch (e) {
                                        console.error('Failed to load more resolved conversations:', e)
                                    } finally {
                                        setResolvedLoadingMore(false)
                                    }
                                }}
                                disabled={resolvedLoadingMore}
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                            >
                                {resolvedLoadingMore ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* COLUMN 3: Chat Messages */}
            {selectedChat ? (
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Chat Header */}
                    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 h-16 px-4">
                            <div className="flex items-center gap-3 min-w-0">
                                <button
                                    className="md:hidden flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                                    onClick={() => { setSelectedChat(null); navigate('/dashboard/chats') }}
                                    aria-label="Back to conversations"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                </button>
                                <div className="relative flex-shrink-0">
                                    <UserAvatar
                                        seed={getVisitorAvatarSeed(conversation?.visitor_name, conversation?.session_id)}
                                        bgColor={conversation?.visitor_avatar_color}
                                        className="w-9 h-9"
                                        iconClassName="w-9 h-9"
                                        title={conversationDisplayName(conversation as any)}
                                    />
                                    <HandlerBadge
                                        botOnly={isBotOnlySelected}
                                        assignedAgentId={(conversation as any)?.assigned_agent_id}
                                        agent={(conversation as any)?.assigned_agent}
                                    />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-sm sm:text-base md:text-sm font-semibold text-gray-900 dark:text-white truncate">
                                        {conversationDisplayName(conversation as any)}
                                    </h2>
                                    {isVisitorEnded && !isResolvedSelected && (
                                        <span className="sm:hidden inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                                            Visitor ended
                                        </span>
                                    )}
                                    {isBotOnlySelected && (
                                        <span className="sm:hidden inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                                            <Bot className="h-3 w-3" /> Bot-only
                                        </span>
                                    )}
                                    {(() => {
                                        const isOnline = Boolean((conversation as any)?.is_online)
                                        // last_seen_at tracks actual presence (connect + heartbeat pings),
                                        // so it's the correct "last seen" signal. last_visitor_message_at
                                        // only reflects when they last typed something, which can be far
                                        // more stale than when they were actually last connected — using
                                        // it as primary (the previous bug) showed wildly wrong times for
                                        // anyone who stayed connected without sending more messages.
                                        const lastActiveTs = conversation?.last_seen_at || (conversation as any)?.last_visitor_message_at
                                        if (isOnline) {
                                            return (
                                                <p className="flex text-xs text-green-500 items-center gap-1">
                                                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                                                    Online
                                                </p>
                                            )
                                        }
                                        return lastActiveTs ? (
                                            <p className="flex text-xs text-gray-500 dark:text-gray-400 items-center gap-1">
                                                Last seen {formatLastSeen(lastActiveTs)}
                                            </p>
                                        ) : null
                                    })()}
                                </div>
                            </div>

                            {/* Header Actions */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {isVisitorEnded && !isResolvedSelected && (
                                    <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                                        Visitor ended
                                    </span>
                                )}
                                {isBotOnlySelected && (
                                    <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                                        <Bot className="h-3.5 w-3.5" /> Bot-only
                                    </span>
                                )}
                                {/* Bot-only conversations self-resolve (see
                                    _close_bot_conversation_after_delay) — no manual Resolve
                                    action needed or offered. */}
                                {!isResolvedSelected && !isBotOnlySelected && (
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={handleResolve}
                                        disabled={resolving}
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        <Check className="h-4 w-4 sm:mr-1" />
                                        <span className="hidden sm:inline">{resolving ? "Resolving..." : "Resolve"}</span>
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="lg:hidden dark:text-gray-300"
                                    onClick={() => setShowMobileDetails(true)}
                                    title="Visitor details"
                                >
                                    <PanelRightOpen className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Second row: Tag conversation (left) | Assign team (right) */}
                        <div className="flex items-center justify-between gap-4 px-4 py-2">
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
                                        className={`inline-flex items-center gap-1.5 rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300${canAssignTeam(user) ? ' cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors' : ''}`}
                                        onClick={canAssignTeam(user) ? () => setTeamPickerOpen(true) : undefined}
                                        title={canAssignTeam(user) ? 'Click to change team' : String((selectedTeam as any)?.name || '')}
                                    >
                                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="text-blue-500 dark:text-blue-400">Team:</span>
                                        <span className="truncate max-w-32 font-semibold">{String((selectedTeam as any)?.name || '')}</span>
                                        {canAssignTeam(user) && (
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

                                {canAssignTeam(user) && (
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
                                    .filter((msg) => (msg as any).event_type !== 'rating_popup_shown')
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
                                        const isVisitor = !isAgent && !isBot && !isSystemEvent && (senderType === 'visitor' || actor === 'visitor')
                                        // CC1: sender_type is 'agent', so this must be checked before the
                                        // generic isAgent bubble below or it'd render as plain text.
                                        const isContactCard = eventType === 'contact_card'
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
                                                        <div className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                                                            <span>{msg.content}</span>
                                                            <span className="text-gray-400 dark:text-gray-500">&middot;</span>
                                                            <span className="text-gray-400 dark:text-gray-500">
                                                                {new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ) : isContactCard ? (
                                                    (() => {
                                                        let cardData: any = null
                                                        try { cardData = JSON.parse((msg as any).raw_content || msg.content) } catch { /* plain text fallback */ }
                                                        const displayText = (cardData && cardData.message) || msg.content
                                                        const fields: any[] = (cardData && Array.isArray(cardData.fields)) ? cardData.fields : []
                                                        const ccState = (msg as any).contact_card_state || { status: 'pending' }
                                                        const avatarUrl = (msg as any).sender_avatar_url
                                                        const senderName = (msg as any).sender_name
                                                        return (
                                                            <div className="flex justify-end">
                                                                <div className="flex items-end gap-2 max-w-[70%] min-w-0">
                                                                    <div className="min-w-0">
                                                                        <div className="bg-blue-600 text-white rounded-2xl px-4 py-2 shadow-sm">
                                                                            <MarkdownMessage content={unescapeMarkdown(displayText)} className="text-sm" />
                                                                        </div>
                                                                        <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 p-3">
                                                                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                                                                                <UserPlus className="h-3.5 w-3.5" />
                                                                                {cardData?.form_name || 'Form'}
                                                                            </div>
                                                                            {ccState.status === 'filled' ? (
                                                                                <div className="space-y-1">
                                                                                    {fields.map((f: any) => (
                                                                                        <div key={f.name} className="flex justify-between gap-3 text-xs py-1 border-b border-gray-200 dark:border-gray-700 last:border-0">
                                                                                            <span className="text-gray-500 dark:text-gray-400">{f.label || f.name}</span>
                                                                                            <span className="font-medium text-gray-900 dark:text-gray-100 text-right break-words">{ccState.data?.[f.name] || '—'}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            ) : ccState.status === 'expired' ? (
                                                                                <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded-lg px-2 py-1.5">
                                                                                    Expired — visitor didn't fill this in time.
                                                                                </div>
                                                                            ) : (
                                                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                                    Waiting for the visitor to fill this in…
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400 justify-end">
                                                                            <span>{new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                        </div>
                                                                    </div>
                                                                    {avatarUrl ? (
                                                                        <img
                                                                            src={String(avatarUrl).startsWith('http') ? avatarUrl : `${API_BASE}${avatarUrl}`}
                                                                            alt={senderName || 'Agent'}
                                                                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                                                            {(senderName || 'AG').trim().split(/\s+/).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase()}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )
                                                    })()
                                                ) : isBot ? (
                                                    // Bot/automation/system messages render on the agent side with a robot avatar.
                                                    <div className="flex justify-end">
                                                        <div className="flex items-end gap-2 max-w-[70%] min-w-0">
                                                            <div className="group relative bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-2xl px-4 py-2 shadow-sm border border-gray-200 dark:border-gray-700 min-w-0">
                                                                <MarkdownMessage content={unescapeMarkdown(msg.content)} className="text-sm" />
                                                                <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                                    <span>{new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                </div>
                                                            </div>
                                                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                                <BotAvatarIcon className="w-6 h-6" />
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
                                                                <MarkdownMessage content={isVisitor ? escapeVisitorMarkdown(msg.content) : unescapeMarkdown(msg.content)} className="text-sm" />
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
                        ref={composerRef}
                        conversationId={selectedChat}
                        onTyping={scheduleAgentTyping}
                        onSend={(content) => handleSendMessage(content)}
                        onSendContactCard={selectedWebsiteId && (formsByWebsiteId[selectedWebsiteId] || []).length > 0 ? handleSendContactCard : undefined}
                        sendableForms={selectedWebsiteId ? formsByWebsiteId[selectedWebsiteId] : undefined}
                        disabled={isResolvedSelected || isVisitorEnded || isBotOnlySelected}
                        placeholder="Reply to live chat"
                        statusText={visitorTyping ? 'Visitor is typing…' : spectatorAgentTyping ? `${spectatorAgentTyping} is typing…` : ''}
                        personalShortcuts={personalShortcuts}
                        websiteShortcuts={selectedWebsiteId ? (websiteShortcutsByWebsiteId[selectedWebsiteId] || []) : []}
                    />
                </div>
            ) : (
                /* Empty State */
                <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="text-center max-w-2xl px-8">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                            <Logo size={56} dotColor={user?.is_available ? '#22c55e' : '#ef4444'} />
                        </div>
                        <h2 className="text-2xl font-semibold mb-3 text-gray-900 dark:text-white">Select a conversation</h2>
                        <p className="text-gray-600 dark:text-gray-400">
                            Choose a chat from the list to view messages and reply.
                        </p>
                        {isPushSupported() && Notification.permission === 'granted' && (
                            <div className="mt-6">
                                <button
                                    onClick={handleTestNotification}
                                    disabled={testNotifState === 'loading'}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                                        disabled:opacity-60 disabled:cursor-not-allowed
                                        border-gray-200 dark:border-gray-700
                                        bg-white dark:bg-gray-800
                                        text-gray-600 dark:text-gray-400
                                        hover:bg-gray-50 dark:hover:bg-gray-700
                                        hover:text-gray-900 dark:hover:text-gray-200"
                                >
                                    {testNotifState === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {testNotifState === 'sent' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                    {testNotifState === 'error' && <AlertCircle className="h-4 w-4 text-red-500" />}
                                    {testNotifState === 'no_sub' && <BellRing className="h-4 w-4 text-yellow-500" />}
                                    {testNotifState === 'idle' && <Bell className="h-4 w-4" />}
                                    <span>
                                        {testNotifState === 'sent' && 'Notification sent — check for sound!'}
                                        {testNotifState === 'no_sub' && 'No subscription — enable notifications in settings'}
                                        {testNotifState === 'error' && 'Failed to send — try again'}
                                        {(testNotifState === 'idle' || testNotifState === 'loading') && 'Test notification sound'}
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* COLUMN 4: Visitor Details (Collapsible) */}
            {selectedChat && conversation && (
                <div
                    className={`hidden lg:flex bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex-shrink-0 transition-[width] duration-300 ease-in-out ${rightSidebarCollapsed ? 'w-16' : 'w-80'} h-full min-h-0`}
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
                            <div className="relative">
                                <UserAvatar
                                    seed={getVisitorAvatarSeed(conversation?.visitor_name, conversation?.session_id)}
                                    bgColor={conversation?.visitor_avatar_color}
                                    className="w-10 h-10"
                                    iconClassName="w-10 h-10"
                                    title={conversationDisplayName(conversation as any)}
                                />
                                <HandlerBadge
                                    botOnly={isBotOnlySelected}
                                    assignedAgentId={(conversation as any)?.assigned_agent_id}
                                    agent={(conversation as any)?.assigned_agent}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex h-full flex-col w-full">
                            <div className="h-16 flex items-center justify-end gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
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

                            <div className="flex-1 min-h-0 overflow-y-auto">
                                <VisitorDetailsPanel
                                    conversation={conversation}
                                    notes={notes.map(note => ({
                                        ...note,
                                        creator_name: note.creator_name || 'Unknown'
                                    }))}
                                    browsingHistory={browsingHistory}
                                    rating={conversationRating}
                                    formSubmissions={formSubmissions}
                                    onFormSubmissionUpdated={handleFormSubmissionUpdated}
                                    onRequestFormSubmissionsRefresh={refetchFormSubmissions}
                                    onConversationContactSynced={applyConversationContactUpdates}
                                    leadStatusRefreshKey={leadStatusRefreshKey}
                                    onUpdateMetadata={async (data) => {
                                        if (!conversation?.id) return
                                        try {
                                            const resp = (await updateConversationMetadata(conversation.id, data)) as {
                                                visitor_name?: string | null
                                                visitor_email?: string | null
                                                visitor_phone?: string | null
                                            }
                                            applyConversationContactUpdates({
                                                visitor_name: resp?.visitor_name ?? undefined,
                                                visitor_email: resp?.visitor_email ?? undefined,
                                                visitor_phone: resp?.visitor_phone ?? undefined,
                                            })
                                        } catch (e) {
                                            console.error('Failed to update visitor metadata:', e)
                                        }
                                    }}
                                    onAddNote={handleAddNote}
                                    onDeleteNote={handleDeleteNote}
                                />
                                {conversation.closed_by && conversation.status === 'resolved' && (
                                    <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/50">
                                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Closed by</p>
                                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${closedByBadge(conversation.closed_by).className}`}>
                                            {closedByBadge(conversation.closed_by).label}
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
                                                        onClick={() => openVisitorConversation(vc)}
                                                        className={`w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group ${selectedChat === vc.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                                                            }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                                                {vc.title || (vc.short_id ? `Conversation ${vc.short_id}` : `Conversation #${vc.id}`)}
                                                            </p>
                                                            <span className={`text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded-full ${(vc.status || '').toLowerCase() === 'open'
                                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                                                }`}>
                                                                {(vc.status || '').toLowerCase() === 'open' ? 'Open' : 'Resolved'}
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

            {/* Mobile Visitor Details Overlay (below lg breakpoint) */}
            {showMobileDetails && selectedChat && conversation && (
                <div className="lg:hidden fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col bg-white dark:bg-gray-800">
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowMobileDetails(false)}
                            className="dark:text-gray-300 flex-shrink-0"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </Button>
                        <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Visitor Details</h3>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        <VisitorDetailsPanel
                            conversation={conversation}
                            notes={notes.map(note => ({
                                ...note,
                                creator_name: note.creator_name || 'Unknown'
                            }))}
                            browsingHistory={browsingHistory}
                            rating={conversationRating}
                            formSubmissions={formSubmissions}
                            onFormSubmissionUpdated={handleFormSubmissionUpdated}
                            onRequestFormSubmissionsRefresh={refetchFormSubmissions}
                            onConversationContactSynced={applyConversationContactUpdates}
                            leadStatusRefreshKey={leadStatusRefreshKey}
                            onUpdateMetadata={async (data) => {
                                if (!conversation?.id) return
                                try {
                                    const resp = (await updateConversationMetadata(conversation.id, data)) as {
                                        visitor_name?: string | null
                                        visitor_email?: string | null
                                        visitor_phone?: string | null
                                    }
                                    applyConversationContactUpdates({
                                        visitor_name: resp?.visitor_name ?? undefined,
                                        visitor_email: resp?.visitor_email ?? undefined,
                                        visitor_phone: resp?.visitor_phone ?? undefined,
                                    })
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
                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${closedByBadge(conversation.closed_by).className}`}>
                                    {closedByBadge(conversation.closed_by).label}
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
                                                onClick={() => {
                                                    openVisitorConversation(vc)
                                                    setShowMobileDetails(false)
                                                }}
                                                className={`w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group ${selectedChat === vc.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                                        {vc.title || (vc.short_id ? `Conversation ${vc.short_id}` : `Conversation #${vc.id}`)}
                                                    </p>
                                                    <span className={`text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded-full ${(vc.status || '').toLowerCase() === 'open'
                                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                                        }`}>
                                                        {(vc.status || '').toLowerCase() === 'open' ? 'Open' : 'Resolved'}
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
    )
}
