const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"

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
    const error = await res.json().catch(() => ({}))
    
    // If unauthorized, clear token
    if (res.status === 401) {
      clearToken()
    }
    
    throw new Error(error.detail || "Request failed")
  }

  return res.json()
}
