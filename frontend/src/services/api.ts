import { API_BASE } from "../config/endpoints"

/**
 * Get JWT token from localStorage
 */
function getToken(): string | null {
  return localStorage.getItem("auth_token")
}

/**
 * Save JWT token to localStorage
 */
export function saveToken(token: string): void {
  localStorage.setItem("auth_token", token)
}

/**
 * Remove JWT token from localStorage
 */
export function clearToken(): void {
  localStorage.removeItem("auth_token")
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const error = (() => {
      if (!text) return {}
      try {
        return JSON.parse(text)
      } catch {
        return { detail: text }
      }
    })()

    // If unauthorized, clear token
    if (res.status === 401) {
      clearToken()
    }

    const detail = error.detail
    const message = Array.isArray(detail)
      ? detail.map((e: any) => e.msg || String(e)).join(', ')
      : (typeof detail === 'string' ? detail : null) || "Request failed"
    throw new Error(message)
  }

  // 204 No Content (common for DELETE)
  if (res.status === 204) {
    return undefined as T
  }

  const responseText = await res.text()
  if (!responseText) {
    return undefined as T
  }

  try {
    return JSON.parse(responseText) as T
  } catch {
    // For rare endpoints that return plain text.
    return responseText as unknown as T
  }
}
