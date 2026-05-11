import type { User } from "@/types/index"

/**
 * Role Helper Utilities
 * 
 * Four roles:
 * - system_manager (Administrator): Platform-wide super-admin
 * - owner: Organization owner
 * - manager: Organization admin
 * - agent: Chat handling and personal settings
 */

/**
 * Check if user is System Manager (Administrator) with full access
 */
export const isAdministrator = (user?: User | null): boolean => {
  return user?.role === "system_manager"
}

/**
 * Alias used by SaaS route tree.
 */
export const isSuperAdmin = (user?: User | null): boolean => {
  return user?.role === "system_manager"
}

/**
 * Check if user has admin privileges (System Manager or Manager)
 */
export const isAdmin = (user?: User | null): boolean => {
  return user?.role === "system_manager" || user?.role === "owner" || user?.role === "manager"
}

/**
 * Check if user is a Manager
 */
export const isManager = (user?: User | null): boolean => {
  return user?.role === "manager"
}

/**
 * Check if user is the Organisation Owner
 */
export const isOrgOwner = (user?: User | null): boolean => {
  return user?.role === "owner"
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

/**
 * Check if user can assign teams to conversations.
 * Both admins and agents can assign; team CRUD (create/edit/delete) remains admin-only.
 */
export const canAssignTeam = (user?: User | null): boolean => {
  return isAdmin(user) || isAgent(user)
}
