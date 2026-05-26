# AI ChatAssist — Archived Tasks

---

## Completed (May 2026 — session batch)

### Analytics & Data Bugs

| # | Title | Description |
|---|-------|-------------|
| A1 | **Analytics – New Conversation Miscount** ✅ FIXED | Added `last_visitor_message_at IS NOT NULL` filter to all new-conversation counts. |
| A2 | **Resolved Chats – Wrong Count** ✅ FIXED | Added `closed_by NOT IN ('inactivity','system_auto')` filter; also disabled auto-close/auto-resolve scheduler jobs. |
| A3 | **Analytics – Team Filter Missing** ✅ FIXED | Added `team_id` query param to all 7 conversation endpoints + `agents/summary`. New `GET /analytics/teams/summary` endpoint. Frontend: teams tab + team dropdown filter (website-scoped). |
| A4 | **Analytics – Agent Role Access** ✅ FIXED | Removed `isAdmin()` gate from route and sidebar. AGENT role in `_allowed_website_ids` now scoped to team-member websites only. |

### Infrastructure / Real-time Bugs

| # | Title | Description |
|---|-------|-------------|
| I1 | **Notification "Cold Start" Buffering** ✅ FIXED | Direct-URL navigation (`/dashboard/chats/:id`) caused an infinite chat-panel spinner. Root cause: `loadChatData(showSpinner=true)` set `chatLoading=true` with token T; a racing `loadChatData(showSpinner=false)` bumped `loadMessagesTokenRef` to T+1; the original call's `finally` checked stale token → `setChatLoading(false)` never called. Fix: added `chatLoadingTokenRef` (only updated when `showSpinner=true`). |
| I2 | **Visitors Page – Unstable Counts (Split Brain)** ✅ FIXED | Moved session presence from per-worker in-memory dict to Redis. `register_session` writes `ai:visitor:online:{wid}:{sid}` (90s TTL), heartbeat renews every 60s. `session_presence_snapshot` and `is_session_online` read Redis with in-memory fallback. |
| I3 | **WS Broadcast Team Scoping — Sentinel Fix** ✅ FIXED | Added `_UNROUTED = object()` sentinel as the default for `conversation_team_id` in `broadcast_to_active_agents`, distinguishing "caller omitted team_id (block team-scoped users)" from explicit `None` (broadcast to all). Added `conversation_unrouted: bool` to `BusEvent` for Redis serialization. Wired `conversation_team_id` through all per-conversation broadcast callsites in `ws_chat.py`, `conversation_orchestrator.py`, and `ws_agent.py`. Also fixed a pre-existing bug in `submit_rating` broadcasts (wrong kwargs `message=` / stray `conversation_id=` were silently ignored). |
| I4 | **Spectator Real-time Gaps** ✅ FIXED | Two spectator-path gaps: (1) Conversations list did not update `last_message` preview when the assigned agent sent a message — fixed by adding an `agent_message` handler to the global WS listener in `ConversationsView.tsx` (previously only in the chat-specific handler, which required `selectedChat` to match). (2) Agent typing indicator was invisible to spectating agents — fixed by passing `conversation_team_id=getattr(conv, "team_id", None)` to the typing broadcast in `ws_agent.py`. |

### Feature Bugs

| # | Title | Description |
|---|-------|-------------|
| F1 | **Carrier Queries – Subcategory Branching** ✅ FIXED | Sub-prompt support added to `bot_prompt_buttons` automation node (commits `c5ed342` + `dc2e299`). Branch buttons show a nested prompt with its own button set; leaf buttons send reply, assign team, and fire `automation_complete`. `button_path` array replaces scalar `button_index` for nested navigation. Per-sub-prompt `allow_input` flag: when `false`, widget suppresses text entry and persists the lock to localStorage (survives page reload and history replay). `suppress_waiting_message` and `collect_contact` toggles per button/sub-prompt let informational paths skip the offline contact overlay. Frontend: recursive `ButtonEditor` component (max depth 4, colour-coded borders) in `AutomationFlowCanvas.tsx`. Widget updated to send `button_path`, handle `automation_complete` with `allow_input`, and restore input-lock state on reconnect. |
| B1 | **Team-Level Offline Detection After Bot Routing** ✅ FIXED | `is_team_online(team_id)` added to `website_resolver.py` (commit `21d3a6f`): checks office hours, then team members with active heartbeat, then falls back to no-team agents on the website (so a website with teams still shows online when general agents are present). Used at all three offline-gate sites in `conversation_orchestrator.py`: `handle_bot_button_click` (leaf path), `handle_visitor_message`, and `_send_delayed_waiting_message_if_unassigned`. `collect_contact` flag per button: team-online check and contact overlay are skipped for buttons that opt out (informational paths). Offline-prompt automation now enabled by default for new websites. |
| F2 | **Notification Scoping – Wrong Team Recipients (Initial Fix)** ✅ FIXED | Two gaps fixed in `conversation_orchestrator.py`: (1) `_broadcast_new_chat_to_agents` passed `website_id=None`, bypassing the org/website visibility gate. Fixed to pass `website_id=conversation.website_id`. (2) Bot button-click `visitor_message` broadcast was missing `conversation_team_id`. Fixed: added `conversation_team_id=getattr(conversation, "team_id", None)`. |

### Push Notification Bugs

| # | Title | Description |
|---|-------|-------------|
| P1 | **Push Delivered After Logout** ✅ FIXED | `handleLogout` in `DashboardLayout.tsx` / `SuperAdminLayout.tsx` now calls `POST /push/unsubscribe` (removes DB row) then `subscription.unsubscribe()` (removes browser channel) before clearing the JWT. |
| P2 | **Push Not Reaching No-Team Agents for Team Conversations** ✅ FIXED | `_get_eligible_agent_ids_for_push()` now computes `no_team_agent_ids = assigned_agent_ids − all_team_member_ids_on_website` and unions them into `agent_candidates`, so agents with no team assignment are included for team conversations. |
| P3 | **Push Type Differentiation** ✅ DONE | Added `push_type: "new_chat" \| "new_message"` to all push payloads. SW uses different `tag` prefixes and `vibrate` patterns per type. `push_type` forwarded via postMessage for in-app sound differentiation. |
| P4 | **Push Notification Click Routing + Background Sound** ✅ FIXED | (1) Notification click was not focusing the correct tab or navigating to the right path. Fixed `sw.js` `notificationclick`: scope-based client matching (`allClients.find(c => c.url.startsWith(self.registration.scope))`) + absolute URL construction via `new URL(notifUrl, self.registration.scope).href`. Falls back to `client.postMessage({ type: 'navigate' })` if `client.navigate()` is blocked. (2) Background tab sound missed due to AudioContext throttling. Added `document.hidden` check + `_pendingPushQueue` module-level queue in `App.tsx` + `visibilitychange` catch-up handler. Dual delivery via BroadcastChannel + postMessage for throttled-but-not-frozen tabs. |
| P5 | **Push Manager Team Scoping + title fallback removal** ✅ FIXED | `_get_eligible_agent_ids_for_push` was treating MANAGER identically to OWNER (always eligible), causing managers to receive push for all teams' conversations. Fixed: OWNER and MANAGER are now queried separately; MANAGER team memberships are fetched in a single batch query and filtered exactly like `compute_visibility_scope` — no teams = unrestricted, has teams = only their teams (or unrouted conversations). Also removed the fragile `title.toLowerCase().startsWith('new chat')` fallback in `App.tsx` — `push_type` is the authoritative field. |

### Auth / Session Infrastructure

| # | Title | Description |
|---|-------|-------------|
| S1 | **Login Sessions Table + Server-side Revocation** ✅ FIXED | `user_login_sessions` table via Alembic migration (`b4c5d6e7f8a9`). `jti` UUID claim added to every JWT. `deps.py` validates jti on every request. Logout calls `revoke_session(jti)`. |
| S2 | **Persistent PWA Login — Remove 24 h Expiry** ✅ FIXED | `ACCESS_TOKEN_EXPIRE_MINUTES` extended to 30 days. Security relies on jti revocation (S1). |
| S3 | **Active Sessions View in Settings** ✅ FIXED | `GET /auth/sessions` and `DELETE /auth/sessions/{jti}` endpoints. `PersonalSettings.tsx` shows "Logged-in Devices" card with device icon, UA label, IP, last-active, "Current" badge, per-session revoke button. |

### PWA / Sound Fixes

| # | Title | Description |
|---|-------|-------------|
| W1 | **Conversation Creation Crash — `datetime` Not Defined** ✅ FIXED | `conversation_service.py` used `datetime.utcnow()` without importing `datetime`. Bot button-click flows were silently failing to create conversations. |
| W2 | **Alembic Duplicate Revision ID** ✅ FIXED | `add_user_login_sessions.py` and `add_website_id_to_tags.py` both claimed revision `a1b2c3d4e5f6`. Renamed login-sessions revision to `b4c5d6e7f8a9`. |
| W3 | **PWA Sounds Silently Failing on iOS** ✅ FIXED | `_playFile` in `notificationSound.ts` now returns `Promise<boolean>`. `_playNotificationSound` falls through to synthesised-tone AudioContext fallback if it returns false. |
| W4 | **PWA Foreground Sound Blocked When WS Reconnects** ✅ FIXED | Removed erroneous `if (!document.hidden) return` guard from SW `postMessage` handler. Added 1500 ms deduplication gate and `resumeAudioContextIfSuspended()` before sound calls. |
| W5 | **Push Subscription Error Capture for Diagnostics** ✅ DONE | `ensurePushSubscription()` captures all early-exit and exception paths to `_lastSubscriptionError` (via `getLastPushSubscriptionError()`). |

### Widget UX Improvements

| # | Title | Description |
|---|-------|-------------|
| V1 | **Scroll Isolation — Widget Scrolls Host Page** ✅ FIXED | Added `overscroll-behavior: contain` to `#chatassist-messages`. `wheel` listener calls `preventDefault()` only at scroll boundaries. |
| V2 | **Header Button Swap — Prevent Accidental Chat End** ✅ DONE | Swapped header button order: X (End chat) left, ↓ chevron (Minimize) right. |
| V3 | **End-Chat Dialog Button Redesign** ✅ DONE | End chat de-emphasised to grey outline (left); Minimize promoted to solid blue primary (right). |

---

## Earlier Completed Work (pre-May 2026)

Last updated: 2026-01-12

### Local setup + stability
- Backend/frontend running locally (env + deps fixed)
- Frontend build/import issues fixed
- CORS configuration stabilized (env-driven; no wildcard+credentials regression)

### Database + migrations hygiene
- PostgreSQL setup
- Alembic migration chain stabilized so `alembic upgrade head` is reliable on new/dirty DBs

### Go-live hardening
- Widget domain-lock implemented (including subdomains)
- Presence reliability improvements
- Redis bus hardening and multi-worker-safe throttling/rate-limiting

### Unread system (Milestone 2)
- DB-backed read/unread state via `conversation_reads`
- `unread_count` included in `/chats/active`
- `/chats/{id}/read-state` (`first_unread_message_id`) and `/chats/{id}/read`
- Realtime unread event type (`conversation_unread`)

### DTO consistency refactor
- Canonical message presenter/serializer (`serialize_message`)
- Realtime payloads include `message_obj` while keeping legacy keys for compatibility

### Deployment artifacts (no-Docker templates)
- Nginx + systemd templates added consistent with runbook

### Regression fixes (Jan 2026)
- Dashboard unread drift mitigation + auto-mark-read behavior (frontend)
- Unread ribbon no longer sticks indefinitely (frontend)
- Widget first-open welcome automation fixed by defaulting welcome message server-side

### Realtime reliability fix (Jan 2026)
- Fixed WS/HTTP auth timezone mismatch that could crash WS auth and cause abnormal close `1006` loops

### Production readiness (Jan 2026)
- Liveness + readiness probes: `/health/live` and `/health/ready` (DB + optional Redis check)

### Phase 2 — Realtime & Presence that scales
- Redis Pub/Sub realtime bus (optional; enabled when `REDIS_URL` is set)
- Visitor + agent delivery support Redis bus (`visitor_direct`, `agent_direct`, `agent_broadcast`)
- Single global agent socket model (`/ws/agent/0`)
- Phase 2.1: Replaced `@app.on_event` with FastAPI lifespan handlers
- Phase 2.2: Multi-worker routing verification suite (unit tests)
- Phase 2.3: Redis "required in prod when multi-worker" guardrails + startup log
- Phase 2.4: Connection hygiene (visitor + agent socket unregister on disconnect)

### Phase 2.5 — Agent availability (PWA / Push)
- PWA installability (`site.webmanifest` + icons + service worker)
- In-app notifications wired to global agent socket events
- Web Push (VAPID): subscription endpoint, per-agent storage, push on `new_chat`
- Widget notification scope decided + implemented

### Phase 3 — Observability
- `/metrics` Prometheus-text endpoint (HTTP + WS)
- Request correlation via `X-Request-ID` + per-WS connection correlation fields
- Readiness/liveness checks

### Phase 4 — Quality gates
- Unit tests for metrics registry rendering
- WebSocket flow integration tests (presence + error handling)
- Widget domain-lock rejection tests
- `page_view` event semantics tests
- Rate limiting behavior tests (in-memory + Redis paths)
- CI: `npm run typecheck` (tsc --noEmit) in GitHub Actions
- CI: backend lint/format gate (ruff) in GitHub Actions

### Analytics miscounts (A1 + A2) — May 2026
- Removed 24 h conversation resume cutoff (row explosion root cause)
- Disabled inactivity scheduler jobs (inflated resolved count root cause)
- `last_visitor_message_at IS NOT NULL` filter on new-conversation counts
- `closed_by NOT IN ('inactivity','system_auto')` filter on resolved counts
- Race condition guard + partial unique index on `conversations(website_id, session_id) WHERE status='open'`
- Dead column cleanup: `conversations.mode` and `conversations.title` dropped

### DB schema audit tool
- `backend/db_audit.py` — detects orphaned columns, always-null columns, ghost tables
- Supports `--null-threshold`, `--generate-sql`, `--execute`
