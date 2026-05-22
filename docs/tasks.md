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

---

## Push Notification Bugs

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| P1 | **Push Delivered After Logout** ✅ FIXED | `handleLogout` in `DashboardLayout.tsx` / `SuperAdminLayout.tsx` now calls `POST /push/unsubscribe` (removes DB row) then `subscription.unsubscribe()` (removes browser channel) before clearing the JWT. Both layouts updated. | High |
| P2 | **Push Not Reaching No-Team Agents for Team Conversations** ✅ FIXED | `_get_eligible_agent_ids_for_push()` now computes `no_team_agent_ids = assigned_agent_ids − all_team_member_ids_on_website` and unions them into `agent_candidates`, so agents with no team assignment are included for team conversations. | Medium |
| P3 | **Push Type Differentiation** ✅ DONE | Added `push_type: "new_chat" \| "new_message"` to all push payloads. Backend: `send_web_push_to_subscriptions()` accepts `push_type` param; orchestrator passes `"new_chat"` for new conversations, `"new_message"` for subsequent messages. SW: different notification `tag` prefixes (`aica:new_chat:` vs `aica:new_message:`) so Android groups them separately; different `vibrate` patterns (double-pulse vs single); `push_type` forwarded in postMessage for in-app sound differentiation. Note: true per-channel Android sound config is not possible via Web Push API — Chrome manages one "General" channel per origin. | Medium |

---

## Auth / Session Infrastructure

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| S1 | **Login Sessions Table + Server-side Revocation** ✅ FIXED | `user_login_sessions` table created via Alembic migration (`b4c5d6e7f8a9`). `jti` UUID claim added to every issued JWT. `deps.py` validates jti against DB on every request (missing or `is_active=False` → 401). `login_sessions.py` repo provides `create_session`, `get_by_jti`, `touch_last_used`, `revoke_session`, `revoke_all_for_user`. Logout calls `revoke_session(jti)`. | High |
| S2 | **Persistent PWA Login — Remove 24 h Expiry** ✅ FIXED | `ACCESS_TOKEN_EXPIRE_MINUTES` extended to `60 * 24 * 30` (30 days). Security relies on jti revocation (S1). Explicit logout revokes session + unsubscribes push + clears localStorage. | High |
| S3 | **Active Sessions View in Settings** ✅ FIXED | `GET /auth/sessions` and `DELETE /auth/sessions/{jti}` endpoints added to `auth.py`. `PersonalSettings.tsx` shows a "Logged-in Devices" card: device icon (Monitor/Smartphone), parsed UA label, IP address, last-active time, "Current" badge, per-session revoke button with loading state. | Low |

---

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU1 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |

---

## PWA / Sound Fixes

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| W1 | **Conversation Creation Crash — `datetime` Not Defined** ✅ FIXED | `conversation_service.py` used `datetime.utcnow()` without importing `datetime`. Added `from datetime import datetime`. Bot button-click flows were silently failing to create conversations. | High |
| W2 | **Alembic Duplicate Revision ID** ✅ FIXED | `add_user_login_sessions.py` and `add_website_id_to_tags.py` both claimed revision `a1b2c3d4e5f6`. Renamed login-sessions revision to `b4c5d6e7f8a9` with `down_revision='c7d8e9f0a1b2'` (the actual head at the time). `alembic upgrade head` runs clean; single head confirmed. | High |
| W3 | **PWA Sounds Silently Failing on iOS** ✅ FIXED | `_playFile` in `notificationSound.ts` caught its own exception, making the AudioContext fallback dead code. Fixed: `_playFile` now returns `Promise<boolean>` (true = success, false = autoplay blocked). `_playNotificationSound` is async, awaits `_playFile`, falls through to synthesised-tone AudioContext fallback if it returns false. Also resumes suspended AudioContext before the fallback tone. | High |
| W4 | **PWA Foreground Sound Blocked When WS Reconnects** ✅ FIXED | SW `postMessage` handler in `App.tsx` had `if (!document.hidden) return`, which prevented sound when the tab was visible but the WebSocket had dropped and reconnected. Removed the guard; a 1500 ms gate deduplicates cases where both WS and SW fire for the same event. Added `resumeAudioContextIfSuspended()` before sound calls in `new_chat` and `visitor_message` WS handlers. | Medium |
| W5 | **Push Subscription Error Capture for Diagnostics** ✅ DONE | `push.ts` `ensurePushSubscription()` now captures all early-exit and exception paths to `_lastSubscriptionError` (exported via `getLastPushSubscriptionError()`). Surfaces root cause (no SW, no PushManager, not secure context, no VAPID key, subscribe exception) for display in settings UI. | Low |

---

## Widget UX Improvements

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| V1 | **Scroll Isolation — Widget Scrolls Host Page** ✅ FIXED | Scrolling inside the widget's message list leaked to the host page when reaching the top or bottom boundary. Fixed: added `overscroll-behavior: contain` + `-webkit-overflow-scrolling: touch` to `#chatassist-messages` in CSS. Added a `wheel` event listener (`{ passive: false }`) in JS that calls `preventDefault()` only at scroll boundaries, and always calls `stopPropagation()`. | Medium |
| V2 | **Header Button Swap — Prevent Accidental Chat End** ✅ DONE | End users were accidentally ending chats by clicking the rightmost X button (expecting it to minimize/close). Fixed: swapped header button order — X (End chat) is now on the left, ↓ chevron (Minimize) is on the right. The rightmost button (natural "close" target) now minimizes the widget. | Medium |
| V3 | **End-Chat Dialog Button Redesign** ✅ DONE | In the "End this chat?" overlay, End chat was the prominent red button (right). Swapped: End chat is now on the left as a grey outline button (destructive, de-emphasised); Minimize is on the right as a solid blue primary button (safe, inviting). Dark-mode overrides updated accordingly. | Medium |
