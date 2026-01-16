function _trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "")
}

function _isLikelyIpOrLocalhost(hostname: string): boolean {
  if (!hostname) return true
  if (hostname === "localhost" || hostname === "127.0.0.1") return true
  // Simple IPv4 check (best-effort)
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true
  return false
}

function _deriveApiHostname(hostname: string): string {
  if (_isLikelyIpOrLocalhost(hostname)) return hostname

  const parts = hostname.split(".").filter(Boolean)
  if (parts.length <= 1) return hostname

  if (parts[0] === "api") return hostname

  // For apex domains (example.com) => api.example.com
  if (parts.length === 2) {
    return ["api", ...parts].join(".")
  }

  // For subdomains (dashboard.example.com) => api.example.com
  const next = [...parts]
  next[0] = "api"
  return next.join(".")
}

export function getApiBase(): string {
  const envBase = String(import.meta.env.VITE_API_BASE || "").trim()
  if (envBase) return _trimTrailingSlashes(envBase)

  if (import.meta.env.DEV) return "http://localhost:8000"

  if (typeof window !== "undefined" && window.location) {
    const protocol = window.location.protocol || "https:"
    const hostname = window.location.hostname || ""
    const apiHostname = _deriveApiHostname(hostname)
    return _trimTrailingSlashes(`${protocol}//${apiHostname}`)
  }

  // Last-resort fallback for non-browser contexts.
  // Prefer relative URLs rather than accidentally targeting localhost.
  return ""
}

export function getWsBase(apiBase: string): string {
  const envWs = String(import.meta.env.VITE_WS_BASE || "").trim()
  if (envWs) return _trimTrailingSlashes(envWs)

  try {
    const url = new URL(apiBase)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return _trimTrailingSlashes(url.origin)
  } catch {
    // Best-effort fallback
    if (apiBase.startsWith("https://")) {
      return _trimTrailingSlashes("wss://" + apiBase.slice("https://".length))
    }
    if (apiBase.startsWith("http://")) {
      return _trimTrailingSlashes("ws://" + apiBase.slice("http://".length))
    }
    return _trimTrailingSlashes(apiBase)
  }
}

export const API_BASE = getApiBase()
export const WS_BASE = getWsBase(API_BASE)
