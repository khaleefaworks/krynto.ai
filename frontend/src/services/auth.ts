import { apiRequest } from "./api"

type LoginPayload = {
  email: string
  password: string
}

export type Agent = {
  id: number
  email: string
  is_active: boolean
}

type LoginResponse = {
  access_token: string
  token_type: string
  agent: Agent
}

export function login(payload: LoginPayload) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function getCurrentUser() {
  return apiRequest<Agent>("/auth/me")
}
