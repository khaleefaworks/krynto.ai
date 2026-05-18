# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native or PWA** | Mobile app for agents. Low priority. Requires pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Analytics & Data Bugs

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| A1 | **Analytics – New Conversation Miscount** ✅ FIXED | Added `last_visitor_message_at IS NOT NULL` filter to all new-conversation counts. | High |
| A2 | **Resolved Chats – Wrong Count** ✅ FIXED | Added `closed_by NOT IN ('inactivity','system_auto')` filter; also disabled auto-close/auto-resolve scheduler jobs. | High |
| A3 | **Analytics – Team Filter Missing** ✅ FIXED | Added `team_id` Query param to all 7 conversation endpoints + `agents/summary`. New `GET /analytics/teams/summary` endpoint. Frontend: teams tab + team dropdown filter (website-scoped). | Medium |
| A4 | **Analytics – Agent Role Access** ✅ FIXED | Removed `isAdmin()` gate from route and sidebar. AGENT role in `_allowed_website_ids` now scoped to team-member websites only. | Medium |

---

## Deferred Features

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| F3 | **Auto-Tag Agent on Assignment** (DEFERRED) | Auto-apply an agent-name tag on claim/takeover/manual-assign. Blocked: disambiguation problem — if two agents share the same first name (e.g. two "Johns"), they'd map to the same tag and make per-agent tag filters inaccurate. Design needed: e.g. "John S." / "John D." initials strategy, or use `agent:{user_id}` as tag key with display name as label. | Medium |
| F4 | **Auto-Tag Events: visitor_dropped / agent_offline** (DEFERRED) | Extend auto-tagging to fire on `visitor_dropped` and `agent_offline` events. Architecture already supports it via `get_or_create_tag` pattern. Deferred until F3 disambiguation is resolved. | Low |

---

## Infrastructure / Real-time Bugs

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| I1 | **Notification "Cold Start" Buffering** ✅ FIXED | Direct-URL navigation (`/dashboard/chats/:id`) caused an infinite chat-panel spinner. Root cause: `loadChatData(showSpinner=true)` set `chatLoading=true` with token T; a racing `loadChatData(showSpinner=false)` (from WS `connected` or other events) bumped `loadMessagesTokenRef` to T+1; the original call's `finally` checked `loadMessagesTokenRef.current === T` → false → `setChatLoading(false)` never called. Fix: added `chatLoadingTokenRef` (only updated when `showSpinner=true`); `finally` now checks `chatLoadingTokenRef.current === token` so silent reloads cannot orphan the spinner. | High |
| I2 | **Visitors Page – Unstable Counts (Split Brain)** ✅ FIXED | Moved session presence from per-worker in-memory dict to Redis. `register_session` writes `ai:visitor:online:{wid}:{sid}` (90s TTL), `unregister_session_socket` writes `ai:visitor:offline:{wid}:{sid}` (600s TTL). `session_presence_snapshot` and `is_session_online` read from Redis when available, fall back to in-memory. WS heartbeat task renews TTL every 60s. | High |

---

## Feature Bugs

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| F1 | **Carrier Queries – Subcategory Branching** | Queries under the Carrier category must branch into exactly two subcategories: (a) New Application and (b) Check Status of Existing Application. Each subcategory needs a customisable message. The Carrier category input box must be disabled — enforce a strict rule-based flow with no free-text entry at the category level. | High |
| F2 | **Notification Scoping – Wrong Team Recipients** ✅ FIXED | Two gaps fixed in `conversation_orchestrator.py`: (1) `_broadcast_new_chat_to_agents` passed `website_id=None`, bypassing the org/website visibility gate — every agent on every org heard the "New chat" sound. Fixed to pass `website_id=conversation.website_id`. (2) Bot button-click `visitor_message` broadcast was missing `conversation_team_id`, skipping team-scope filtering for chatbot-routed conversations. Fixed: added `conversation_team_id=getattr(conversation, "team_id", None)`. | High |
| F3 | **Auto-Tag Agent on Chat Assignment** | When an agent claims/joins a conversation, automatically apply a tag with that agent's name. Must fire immediately on assignment (claim, takeover, or manual assign). | Medium |
