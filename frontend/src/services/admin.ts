import { apiRequest } from '@/services/api'

export interface OrgStats {
    id: number
    name: string
    slug: string
    plan: string
    is_active: boolean
    owner_verified: boolean
    owner_id: number | null
    member_count: number
    website_count: number
    conversation_count: number
}

export interface OrgUpdateRequest {
    plan?: string
    is_active?: boolean
    name?: string
}

export interface AdminUserResponse {
    id: number
    name: string | null
    email: string
    role: string
    is_active: boolean
    organization_id: number | null
    organization_name: string | null
}

export interface PlatformStats {
    total_organizations: number
    active_organizations: number
    total_users: number
    total_websites: number
    total_conversations: number
}

export interface SecurityEventResponse {
    id: number
    event_type: string
    actor_user_id: number | null
    actor_email: string | null
    target_user_id: number | null
    target_email: string | null
    organization_id: number | null
    organization_name: string | null
    ip_address: string | null
    metadata: Record<string, any> | null
    created_at: string | null
}

export interface SecurityEventListResponse {
    items: SecurityEventResponse[]
    total: number
}

export interface SecurityEventFilters {
    organization_id?: number
    event_type?: string
    actor_user_id?: number
    target_user_id?: number
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
}

export interface SchedulerJobInfo {
    id: string
    name: string
    next_run_time: string | null
}

export interface SystemHealthResponse {
    db: string
    redis: string
    active_agent_connections: number
    live_visitor_count: number
    scheduler_jobs: SchedulerJobInfo[]
}

export const fetchOrganizations = () => apiRequest<OrgStats[]>('/admin/organizations')

export const fetchOrganization = (id: number | string) =>
    apiRequest<OrgStats>(`/admin/organizations/${id}`)

export const updateOrganization = (id: number | string, body: OrgUpdateRequest) =>
    apiRequest<OrgStats>(`/admin/organizations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    })

export const fetchAdminUsers = (organizationId?: number) =>
    apiRequest<AdminUserResponse[]>(
        `/admin/users${organizationId ? `?organization_id=${organizationId}` : ''}`
    )

export const fetchPlatformStats = () => apiRequest<PlatformStats>('/admin/stats')

export const fetchSecurityEvents = (filters: SecurityEventFilters = {}) => {
    const qs = new URLSearchParams(
        Object.entries(filters)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)])
    ).toString()
    return apiRequest<SecurityEventListResponse>(`/admin/security-events${qs ? `?${qs}` : ''}`)
}

export const fetchSystemHealth = () => apiRequest<SystemHealthResponse>('/admin/system-health')
