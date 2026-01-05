import { apiRequest } from './api';

export interface Website {
  id: number;
  name: string;
  domain: string;
  widget_key: string;
  widget_config: Record<string, any> | null;
  created_at: string;
  updated_at: string | null;
}

export interface WebsiteCreate {
  name: string;
  domain: string;
}

export interface WebsiteUpdate {
  name?: string;
  domain?: string;
  widget_config?: Record<string, any>;
}

export interface WidgetConfig {
  theme: string;
  position: string;
  welcome_message: string;
  primary_color: string;
}

export const websitesApi = {
  list: async (): Promise<Website[]> => {
    return apiRequest('/websites');
  },

  create: async (data: WebsiteCreate): Promise<Website> => {
    return apiRequest('/websites', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  get: async (id: number): Promise<Website> => {
    return apiRequest(`/websites/${id}`);
  },

  update: async (id: number, data: WebsiteUpdate): Promise<Website> => {
    return apiRequest(`/websites/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: number): Promise<{ success: boolean; message: string }> => {
    return apiRequest(`/websites/${id}`, {
      method: 'DELETE',
    });
  },

  getWidgetConfig: async (id: number): Promise<WidgetConfig> => {
    return apiRequest(`/websites/${id}/widget-config`);
  },

  updateWidgetConfig: async (id: number, config: Partial<WidgetConfig>): Promise<{ success: boolean; config: WidgetConfig }> => {
    return apiRequest(`/websites/${id}/widget-config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
};
