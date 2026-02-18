import { apiRequest } from '@/services/api'

export interface CustomerVisitor {
    website_id: number
    session_id: string
    is_online: boolean
    online_seconds: number | null
    latest_conversation_id: number | null
    visitor_initiated_chat: boolean
    agent_joined: boolean
    assigned_agent: { id: number; name: string | null; avatar_url: string | null } | null
    visitor_avatar_color?: string | null
    current_page: {
        title: string | null
        url: string
    }
    came_from: string | null
    visits: number
    chats: number
    last_seen_at: string | null
}

export interface CustomerContactTag {
    name: string
    color: string
}

export interface CustomerContact {
    contact_key: string
    website_id: number
    name: string | null
    email: string | null
    phone: string | null
    tags: CustomerContactTag[]
    last_update: string | null
}

export interface CustomerVisitorDetails {
    website_id: number
    session_id: string
    is_online: boolean
    online_seconds: number | null
    visitor_avatar_color?: string | null
    visitor_initiated_chat: boolean
    agent_joined: boolean
    assigned_agent: { id: number; name: string | null; avatar_url: string | null } | null
    visits: number
    chats: number
    came_from: string | null
    current_page: {
        title: string | null
        url: string
    } | null
    device_info: string | null
    browser_info: string | null
    last_seen_at: string | null
    page_views: Array<{
        title: string | null
        url: string
        referrer: string | null
        created_at: string | null
    }>
    conversations: Array<{
        conversation_id: number
        session_id: string
        status: string
        created_at: string | null
    }>
}

export async function initiateVisitorConversation(params: {
    websiteId: number
    sessionId: string
}): Promise<{ conversation_id: number; website_id: number; session_id: string }> {
    return apiRequest<{ conversation_id: number; website_id: number; session_id: string }>(
        `/customers/visitors/${params.websiteId}/${encodeURIComponent(params.sessionId)}/initiate`,
        {
            method: 'POST',
        }
    )
}

export interface CustomerContactDetails {
    contact_key: string
    website_id: number | null
    name: string | null
    email: string | null
    phone: string | null
    tags: CustomerContactTag[]
    last_update: string | null
    visits: number
    chats: number
    conversations: Array<{
        conversation_id: number
        session_id: string
        status: string
        created_at: string | null
    }>
}

export async function fetchVisitors(params?: {
    websiteId?: number
    recentlyLeftWithinSeconds?: number
    limit?: number
}): Promise<CustomerVisitor[]> {
    const qs = new URLSearchParams()
    if (params?.websiteId != null) qs.set('website_id', String(params.websiteId))
    if (params?.recentlyLeftWithinSeconds != null) qs.set('recently_left_within_seconds', String(params.recentlyLeftWithinSeconds))
    if (params?.limit != null) qs.set('limit', String(params.limit))

    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiRequest<CustomerVisitor[]>(`/customers/visitors${suffix}`)
}

export async function fetchVisitorDetails(params: {
    websiteId: number
    sessionId: string
    recentlyLeftWithinSeconds?: number
    pageViewLimit?: number
}): Promise<CustomerVisitorDetails> {
    const qs = new URLSearchParams()
    if (params.recentlyLeftWithinSeconds != null) qs.set('recently_left_within_seconds', String(params.recentlyLeftWithinSeconds))
    if (params.pageViewLimit != null) qs.set('page_view_limit', String(params.pageViewLimit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiRequest<CustomerVisitorDetails>(`/customers/visitors/${params.websiteId}/${encodeURIComponent(params.sessionId)}${suffix}`)
}

export async function fetchContacts(params?: {
    websiteId?: number
    limit?: number
}): Promise<CustomerContact[]> {
    const qs = new URLSearchParams()
    if (params?.websiteId != null) qs.set('website_id', String(params.websiteId))
    if (params?.limit != null) qs.set('limit', String(params.limit))

    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiRequest<CustomerContact[]>(`/customers/contacts${suffix}`)
}

export async function fetchContactDetails(params: {
    contactKey: string
    websiteId?: number
}): Promise<CustomerContactDetails> {
    const qs = new URLSearchParams()
    if (params.websiteId != null) qs.set('website_id', String(params.websiteId))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiRequest<CustomerContactDetails>(`/customers/contacts/${encodeURIComponent(params.contactKey)}${suffix}`)
}
