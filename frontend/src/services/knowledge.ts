import { apiRequest } from './api';

export interface KnowledgeSource {
  id: number;
  website_id: number;
  name: string;
  source_type: string;
  meta: Record<string, any> | null;
  created_at: string;
}

export interface Document {
  id: number;
  website_id: number;
  knowledge_source_id: number;
  title: string;
  source_uri: string | null;
  raw_text: string | null;
  created_at: string;
}

export interface UploadResponse {
  document_id: number;
  title: string;
  chunks_created: number;
  text_length: number;
}

export interface IndexResponse {
  document_id: number;
  chunks_indexed: number;
  message: string;
}

export const knowledgeApi = {
  createSource: async (data: { website_id: number; name: string; source_type: string; metadata?: any }): Promise<{ id: number; name: string }> => {
    return apiRequest('/knowledge/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  uploadDocument: async (websiteId: number, sourceId: number, file: File): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('website_id', websiteId.toString());
    formData.append('knowledge_source_id', sourceId.toString());
    formData.append('file', file);

    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/knowledge/documents/upload`, {
      method: 'POST',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Upload failed');
    }

    return response.json();
  },

  ingestText: async (data: { website_id: number; knowledge_source_id: number; title: string; text: string }): Promise<UploadResponse> => {
    return apiRequest('/knowledge/documents/text', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  indexDocument: async (documentId: number, websiteId: number): Promise<IndexResponse> => {
    return apiRequest(`/knowledge/documents/${documentId}/index?website_id=${websiteId}`, {
      method: 'POST',
    });
  },
};
