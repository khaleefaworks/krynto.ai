import { apiRequest } from './api';

export interface Agent {
  id: number;
  name?: string;
  email: string;
  role?: string;
  is_available?: boolean;
  is_active: boolean;
}

export interface AgentWebsiteAssignment {
  id: number;
  name: string;
  domain: string;
  assigned_at: string | null;
}

export interface WebsiteAgent {
  id: number;
  email: string;
  is_active: boolean;
  assigned_at: string | null;
}

export const agentAssignmentsApi = {
  listAgents: async (): Promise<Agent[]> => {
    return apiRequest('/users');
  },

  assignAgentToWebsite: async (agentId: number, websiteId: number): Promise<{ success: boolean; message: string; assignment_id: number }> => {
    return apiRequest('/agent-assignments/assign', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, website_id: websiteId }),
    });
  },

  unassignAgentFromWebsite: async (agentId: number, websiteId: number): Promise<{ success: boolean; message: string }> => {
    return apiRequest('/agent-assignments/unassign', {
      method: 'DELETE',
      body: JSON.stringify({ agent_id: agentId, website_id: websiteId }),
    });
  },

  getAgentWebsites: async (agentId: number): Promise<AgentWebsiteAssignment[]> => {
    return apiRequest(`/agent-assignments/agent/${agentId}/websites`);
  },

  getWebsiteAgents: async (websiteId: number): Promise<WebsiteAgent[]> => {
    return apiRequest(`/agent-assignments/website/${websiteId}/agents`);
  },

  checkAssignment: async (agentId: number, websiteId: number): Promise<{ is_assigned: boolean; assignment_id: number | null }> => {
    return apiRequest(`/agent-assignments/check?agent_id=${agentId}&website_id=${websiteId}`);
  },
};
