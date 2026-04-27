# PWA Plan of Action (Agent Dashboard)

## Goal
Make agent availability and responsiveness closer to Smartsupp by enabling multi-device usage (mobile) and reducing false-offline transitions when a browser tab closes.

This document is intentionally implementation-oriented (APIs, data flow, milestones).

## Current State (as of 2026-01-06)
- Visitor widget determines online/offline via public presence socket: `/ws/presence/{website_id}`.
- Presence is computed based on active WebSocket connections in memory (`AgentService.active_agents`).
- Closing the agent browser disconnects the socket and can flip presence to offline immediately.

## Target End State
- Agent dashboard is installable (PWA) on desktop + mobile.
- “Online” means **agent reachable** (recent heartbeat from any device), not “this browser tab is open”.
- Push notifications for new visitor messages when the agent app is backgrounded.

## Phase 1 — Make the dashboard a PWA (installable + fast launch)
1. Add Web App Manifest
   - Name, short_name, icons, theme_color, background_color.
   - Display mode: `standalone`.
  - Start URL: `/` (app routes internally; unauthenticated users land on login).

2. Add Service Worker
  - Start with a minimal service worker to satisfy installability (no caching).
  - Defer caching strategy until push notifications (avoid surprises for auth-protected JSON).

3. Install UX
   - Add non-intrusive install prompt handling in dashboard.

Deliverable: agent can “install” dashboard and open it like an app.

## Phase 2 — Presence should be heartbeat-based (multi-device)
### Problem
Presence currently equals “has an open WS connection”. That’s too brittle.

### Proposed model
- Track last heartbeat per agent (and optionally per device session).
- Compute availability as:
  - `available = user.is_active && user.availability_enabled && last_heartbeat_at within TTL`

### Backend changes
- Add `agent_heartbeat` endpoint OR integrate heartbeat over agent WS:
  - Option A (WS): agent sends `{ type: "heartbeat" }` every N seconds.
  - Option B (HTTP): `POST /agents/me/heartbeat` every N seconds.

- Store heartbeat in DB (recommended) so it survives restarts.
  - `users.last_heartbeat_at` (simple) OR new table `agent_devices` (better for multi-device).

- Update `/ws/presence/{website_id}` computation:
  - consider an agent “online” if heartbeat is fresh (e.g., TTL 60s).
  - include a short grace period to avoid flicker.

Deliverable: closing a browser tab does not immediately flip presence to offline if another device is active or if within grace period.

## Phase 3 — Push notifications (required for mobile usability)
- Implement Web Push (VAPID).
- Store push subscriptions per agent.
- Send push when:
  - new visitor message arrives AND
  - agent is eligible/assigned AND
  - no active focused session is connected (optional heuristic).

Deliverable: agent can respond quickly even if app is backgrounded.

## Phase 4 — Mobile-first UX improvements
- Ensure responsive layout in dashboard.
- Quick reply actions.
- Deep-link to conversation.

Deliverable: practical support workflow on mobile.

## Notes / Constraints
- iOS has limitations for background WebSockets; push notifications are the reliable path.
- PWA installability and push notifications require HTTPS (localhost is treated as secure for development).
- A native wrapper (Capacitor) can be considered later if deeper OS integration is needed.
