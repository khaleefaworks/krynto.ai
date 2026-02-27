import { apiRequest } from './api'

export interface AgentAvailability {
    id: number
    name: string
    email: string
    role: string
    avatar_url?: string | null
    is_active: boolean
    is_available: boolean
    is_connected: boolean
    can_receive_chats: boolean
}

export interface TeamOverview {
    id: number
    website_id: number
    name: string
    description?: string | null
    agents: AgentAvailability[]
}

export interface WebsiteTeamsOverview {
    id: number
    name: string
    domain?: string | null
    teams: TeamOverview[]
    unassigned_agents: AgentAvailability[]
    assigned_agents_count: number
    available_agents_count: number
}

export const teamsApi = {
    overview: async (): Promise<WebsiteTeamsOverview[]> => {
        return apiRequest('/teams/overview')
    },
}
