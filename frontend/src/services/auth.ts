import { apiRequest } from "./api"
import { User } from "@/types"

type LoginPayload = {
  email: string
  password: string
}

type LoginResponse = {
  access_token: string
  token_type: string
  user: User
}

export function login(payload: LoginPayload) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function getCurrentUser() {
  return apiRequest<User>("/auth/me")
}
