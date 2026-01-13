import { apiRequest } from "./api"

export interface Tag {
  id: number
  tag_name: string
  created_at: string
  created_by: number | null
}

export interface Note {
  id: number
  content: string
  created_at: string
  created_by: number
  updated_at: string | null
  creator_name: string | null
}

export interface PageView {
  id: number
  title: string | null
  url: string
  referrer: string | null
  device_info: string | null
  browser_info: string | null
  created_at: string
}

export function addTag(conversationId: number, tagName: string) {
  return apiRequest<Tag>(`/conversations/${conversationId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag_name: tagName }),
  })
}

export function getTags(conversationId: number) {
  return apiRequest<Tag[]>(`/conversations/${conversationId}/tags`)
}

export function deleteTag(conversationId: number, tagId: number) {
  return apiRequest(`/conversations/${conversationId}/tags/${tagId}`, {
    method: "DELETE",
  })
}

export function addNote(conversationId: number, content: string) {
  return apiRequest<Note>(`/conversations/${conversationId}/notes`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })
}

export function getNotes(conversationId: number) {
  return apiRequest<Note[]>(`/conversations/${conversationId}/notes`)
}

export function deleteNote(conversationId: number, noteId: number) {
  return apiRequest(`/conversations/${conversationId}/notes/${noteId}`, {
    method: "DELETE",
  })
}

export function updateConversationMetadata(
  conversationId: number,
  data: {
    visitor_name?: string
    visitor_email?: string
    visitor_phone?: string
  }
) {
  return apiRequest(`/conversations/${conversationId}/metadata`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export function getBrowsingHistory(conversationId: number, limit: number = 50) {
  return apiRequest<PageView[]>(`/conversations/${conversationId}/browsing-history?limit=${limit}`)
}
