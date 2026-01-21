import type { User } from "@/types/index"

/**
 * Role Helper Utilities
 * 
 * Three roles:
 * - system_manager (Administrator): Full system access including reset
 * - manager: All admin features except reset application  
 * - agent: Only chat handling and personal settings
 */

/**
 * Check if user is System Manager (Administrator) with full access
 */
export const isAdministrator = (user?: User | null): boolean => {
  return user?.role === "system_manager"
}

/**
 * Check if user has admin privileges (System Manager or Manager)
 */
export const isAdmin = (user?: User | null): boolean => {
  return user?.role === "system_manager" || user?.role === "manager"
}

/**
 * Check if user is a Manager
 */
export const isManager = (user?: User | null): boolean => {
  return user?.role === "manager"
}

/**
 * Check if user is an Agent
 */
export const isAgent = (user?: User | null): boolean => {
  return user?.role === "agent"
}

/**
 * Check if user can access admin features
 * (Alias for isAdmin for clarity in some contexts)
 */
export const canAccessAdminFeatures = (user?: User | null): boolean => {
  return isAdmin(user)
}

/**
 * Check if user can handle chats
 * (Both admins and agents can handle chats)
 */
export const canHandleChats = (user?: User | null): boolean => {
  return isAdmin(user) || isAgent(user)
}
