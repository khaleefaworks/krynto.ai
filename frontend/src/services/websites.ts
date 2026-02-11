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

  // NOTE: widget-config is a public, origin-locked endpoint meant for the embedded widget.
  // Admin UIs should use authenticated `get`/`update` and edit `website.widget_config`.
};
