import { apiRequest } from "./api"

type LoginPayload = {
  email: string
  password: string
}

type LoginResponse = {
  access_token: string
  agent: {
    id: number
    email: string
    is_active: boolean
  }
}

export function login(payload: LoginPayload) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
