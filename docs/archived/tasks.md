# AI ChatAssist — Archived Tasks

---

## Completed (July 2026 batch)

### Push Notifications & Widget

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| PN1 | **New chat notification repeats until claimed** ✅ Done | Redefined from the original "staggered bot message" description. `_broadcast_new_chat_to_agents` re-fires (WS + push) until an agent joins, the conversation resolves, or the visitor ends the chat. Refined: (1) pauses while the visitor is actually disconnected, auto-resumes on reconnect (checks `ChatService.active_visitors` each tick); (2) the repeat interval + on/off switch is the `new_chat_unclaimed` automation trigger (cooldown_seconds) — now auto-seeded (enabled, 15s) for every website, same as the other default automations; (3) repeat pushes say "Chat waiting to be claimed" instead of reusing the "New chat" wording. Also fixed: default-automation seeding (`ensure_default_automations_for_website`) was dead code since Apr 2026 (never wired into `create_website`) — restored, and made non-destructive (only backfills missing defaults, never overwrites customized ones like Team routing chatbot's buttons). Also fixed: chat panel's visitor online dot now reads the same session-level presence (`ChatService.is_session_online`) everywhere (WS push + REST snapshot), instead of two different, sometimes-inconsistent sources. | Medium |
| PN2 | **Visitor rejoin push notification** ✅ Done | Implemented as a generic `show_notification` toggle on automation `emit_system_event` nodes (reusable for any future node/trigger), turned on for the "Visitor dropped event" and "Visitor reconnected" seed automations. Plays each agent's own "message" sound preference + sends push, same as a regular message. New websites get it by default; existing orgs (e.g. org 1) need to flip the toggle once in Settings → Automations. | Medium |
| W1 | **Widget new message popup styling** ✅ Done | Popup shrunk (300px→272px, tighter padding/avatar/close button, shorter body max-height) and launcher pill tightened (icon 40→36px, text 15→14px) on all screen sizes. On mobile (≤480px) the "Chat with us" text label is hidden entirely (icon + unread badge only) and the popup width becomes viewport-relative instead of a fixed 300px. Desktop keeps the text label. Widget-only change — verified visually via rendered screenshots at 800px and 375px. | Medium |
| W2 | **Welcome popup repeats on every page nav** ✅ Done | Redefined from the original "team routing notification dedup" description. Actual issue: the proactive welcome popup was only silenced by an explicit "x" dismissal (12h cooldown); a visitor who never clicked it got the same popup — sound, unread bump, all — on every single page navigation, since each page load replays history and re-triggers the "hasn't sent a message yet" re-show path. Added a shown-count cap (industry-standard proactive-message pattern): shows at most twice per 12h rolling window (same window as the dismissal cooldown), then stays silent until it rolls over — same as if explicitly dismissed. Doesn't affect genuine new-message notifications (agent replies, new bot messages), only the recurring welcome greeting. | Medium |
| W3 | **"Connecting to agent..." indicator** ✅ Done | Rotating reassurance text ("Connecting you to an agent…" → "Hang tight, almost there…" → "Thanks for your patience…", every 3.5s) in the same spot as "Agent is typing". Shows only after the visitor has actually engaged (message sent or leaf button committed) and a real agent is expected — suppressed for bot-only informational paths (e.g. Careers → New Application/Check Status, where `automation_complete.allow_input=false`) and while the offline contact-form overlay is up. Hides for good once `agent_joined` fires; correctly re-derived from history on reload. Verified end-to-end in a real headless-browser session against the live backend (not just code review). | Medium |

### Availability & Status

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AV1 | **Agent offline warning on send** ✅ Done (d2ceb97) | Agent sees a confirmation popup before send/join while offline instead of silent auto-toggle. | High |

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
| F1 | **Carrier Queries – Subcategory Branching** ✅ FIXED | Sub-prompt support added to `bot_prompt_buttons` automation node (commits `c5ed342` + `dc2e299`). Branch buttons show a nested prompt with its own button set; leaf buttons send reply, assign team, and fire `automation_complete`. `button_path` array replaces scalar `button_index` for nested navigation. Per-sub-prompt `allow_input` flag: when `false`, widget suppresses text entry and persists the lock to localStorage (survives page reload and history replay). `suppress_waiting_message` and `collect_contact` toggles per button/sub-prompt let informational paths skip the offline contact overlay. Frontend: recursive `ButtonEditor` component (max depth 4, colour-coded borders) in `AutomationFlowCanvas.tsx`. Widget updated to send `button_path`, handle `automation_complete` with `allow_input`, and restore input-lock state on reconnect. **Follow-up fix:** team dropdown in `ButtonEditor` was inside the `{!btn.sub_prompt && (...)}` leaf-only guard, hiding the team selector for branch buttons. Moved outside the guard so team assignment is available for all button types regardless of sub-prompt. |
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
| P6 | **No-Team Agent/Manager Push+Sound Suppression + Button-Click Ordering Fix** ✅ FIXED | Three related gaps fixed: (1) **No-team agents push**: `_get_eligible_agent_ids_for_push` was unioning `no_team_agent_ids` into `agent_candidates` for team-routed conversations (P2's intent was catch-all coverage, but caused agents unrelated to the team to receive push). Removed the union — only members of the specific team are eligible for OS push on team-routed conversations. (2) **No-team MANAGER push**: MANAGER with no team membership was always eligible; now eligible only for unrouted (`conversation_team_id=None`) conversations. (3) **WS new_chat + unread sound for no-team users**: `is_team_scoped_role` flag added to agent_info in `agent_service.py` (True for AGENT+MANAGER). `broadcast_to_active_agents` and `deliver_bus_event` now block both `new_chat` and `conversation_unread` events for no-team AGENT/MANAGER on team-routed conversations (previously only blocked `conversation_unread` for AGENT). (4) **Button-click ordering**: `_button_team_id` extracted from button config before any DB write in `handle_bot_button_click`. Passed as `_team_id_hint` to `_broadcast_new_chat_to_agents` (new `_TEAM_HINT_UNSET` sentinel distinguishes "no hint" from explicit None) and as `conversation_team_id` to the visitor_message broadcast — both are now correctly scoped to the button's team even before `conversation.team_id` is committed. |

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
| B3 | **Widget Contact Overlay — Stale `team_online` Snapshot + Push on Sub-Buttons + Overlay Preview** ✅ FIXED | Four gaps: (1) `bot_prompt_buttons` baked `team_online` once at conversation-creation time; the snapshot was stale in both directions (team offline→online and online→offline). Added `GET /widget/team-online?website_id=&team_id=` backend endpoint; widget now calls it at click time for every leaf button when `presenceOnline=true`, ignoring the stale snapshot. (2) `_forceContactOverlay` was never cleared: once the overlay appeared (team offline while website online), it persisted even after agents came back online. Fix: `applyPresence()` clears `_forceContactOverlay` and dismisses the overlay when `presenceOnline=true`, unless `_contactFormTouched` is set. (3) Added `_contactFormTouched` flag so `applyPresence()` does not auto-dismiss the contact form mid-input when agents come online. (4) `_broadcast_new_chat_to_agents` was called on branch-button clicks (sub-menu navigation) before the visitor made their real selection — hitting empty teams (e.g. HR with no members) and never firing on the actual leaf click. Moved broadcast to the leaf path with condition `prior_visitor_msg_count <= len(path) - 1`, so it fires exactly once on the first real leaf action regardless of sub-menu depth. Also: contact overlay preview now shows the selected button label (e.g. `"Investments"`) when opened via button-click offline path, not just for free-typed messages. |
| V1 | **Scroll Isolation — Widget Scrolls Host Page** ✅ FIXED | Added `overscroll-behavior: contain` to `#chatassist-messages`. `wheel` listener calls `preventDefault()` only at scroll boundaries. |
| V2 | **Header Button Swap — Prevent Accidental Chat End** ✅ DONE | Swapped header button order: X (End chat) left, ↓ chevron (Minimize) right. |
| V3 | **End-Chat Dialog Button Redesign** ✅ DONE | End chat de-emphasised to grey outline (left); Minimize promoted to solid blue primary (right). |

---

## Completed (May 2026 — session batch 2)

### Bot-Only Conversations

| # | Title | Description |
|---|-------|-------------|
| BOT1 | **Bot-Only Conversations — Silent Auto-Resolve (Careers Path)** ✅ DONE | Full implementation of bot-only conversation handling. (1) `bot_only` boolean column on `conversations` table (Alembic migration). (2) Orchestrator: `_is_bot_only` computed early (before any broadcast) from button config + `sub_prompt.bot_only`; branch-click immediately sets `conversation.bot_only=True` in DB. (3) `_close_bot_conversation_after_delay` async task silently resolves after configurable delay (`resolve_delay_seconds`, default 3 s, range 1–30 s). (4) Visitor_message WS broadcast suppressed for bot_only conversations. (5) `unread_count` forced to 0 server-side for bot_only conversations in `/chats/active`. (6) Frontend: `Bot` sidebar filter in `ConversationsView` (type `FilterCategory = 'bot'`); All/Mine/Unassigned views exclude bot_only. Mobile tabs include Bot count. (7) `ButtonEditor` in `AutomationFlowCanvas`: leaf button `bot_only` toggle + `resolve_delay_seconds` input; branch sub_prompt `bot_only` toggle (hides allow_input/suppress_waiting/collect_contact). (8) Analytics: `closed_by='bot'` excluded from all 3 resolved-conversation counts alongside `'inactivity'` / `'system_auto'`. (9) Startup reconciliation in `lifespan`: stale OPEN+bot_only conversations are auto-resolved on server restart. |

### Widget UX & Reliability Bugfixes

| # | Title | Description |
|---|-------|-------------|
| BUG1 | **Widget Textarea Height = 0 After Input Reveal** ✅ FIXED | `showInputContainer()` hid the container with `display:none` during bot flows; when re-revealed, `autoResizeInput()` had already run and measured `scrollHeight=0`. Fixed by adding `setTimeout(() => autoResizeInput(), 0)` inside `showInputContainer()` so the resize runs after the browser has laid out the visible element. |
| BUG2 | **`closeWidget` ReferenceError in `hideRatingOverlay`** ✅ FIXED | `closeWidget` is a closure nested inside `createWidget()` and is not accessible from outer-scope functions. `hideRatingOverlay` called `setTimeout(() => closeWidget(false), 200)` — the `try/catch` wrapping `setTimeout()` does not catch the callback's deferred error. Fixed via module-level `let _closeWidgetFn = null` assigned inside `createWidget()`; all outer-scope call sites use `if (_closeWidgetFn) setTimeout(() => _closeWidgetFn(false), 200)`. |
| BUG3 | **Widget Reload Returns Wrong Conversation (Missing ORDER BY)** ✅ FIXED | `GET /widget/conversations` queried OPEN conversations with `.first()` and no `ORDER BY`, causing PostgreSQL to return the oldest row (lowest ID = visitor_ended=True stale conv) instead of the newest active one. Fixed with a two-phase query: (1) prefer `visitor_ended=False ORDER BY id DESC`; (2) fall back to any OPEN `ORDER BY id DESC`. Same `ORDER BY id DESC` added to `POST /conversations/new` existing-open check. |
| BUG4 | **Widget Init Shows Wrong Thread on Reload** ✅ FIXED | When a stale OPEN+visitor_ended conv had a lower ID than a newer resolved conv in history, `init()` always showed the older ended thread. Fixed: when `active.visitor_ended=True`, compare `history[0].id` vs `active.id` and enter thread for whichever is higher (most recent). |
| BUG5 | **Widget History Disabled Uses Stale localStorage** ✅ FIXED | When `active=null` and history disabled, `init()` fell back to a conv ID from localStorage which could be arbitrarily old. Fixed: prefer `listData.history[0]` (always fresh from API); localStorage is now last resort only if the API also returns no history. |
| BUG6 | **Widget History Enabled + No Active Shows Start View** ✅ FIXED | When `show_conversation_history=true`, `active=null`, but resolved conversations exist in history, `init()` called `enterStartView()` instead of `enterListView()`. Fixed: if `widgetShowHistory && listData.history.length > 0` → `enterListView(listData)`. |
| BUG7 | **Conversation List Wrong Ordering (Ended Active Above Newer Resolved)** ✅ FIXED | `renderConvList` always pinned the `active` conversation (even when `visitor_ended=True`) above history items, causing an older ended conv to appear above a newer resolved one. Fixed: when `active.visitor_ended=True`, merge it into a unified `pastConvs` array with history items, sort by `id DESC`, render in correct recency order. Only a real non-ended active conv is now pinned at top with "Active" badge. |

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

---

## Completed (May 2026 — Analytics + Rating + Push batch)

### Analytics Overhaul (AN1) ✅ COMPLETE

| Area | What was done |
|------|---------------|
| **resolved_at column** | Added `resolved_at DateTime` to `conversations` (migration `cc1dd2ee3ff4`). Backfilled from `updated_at` for existing resolved rows. Set on close in `conversation_service.py` and `conversation_orchestrator.py`. |
| **Ghost session exclusion** | All analytics counts and Excel export now filter `last_visitor_message_at IS NOT NULL` — WebSocket-connect-only sessions no longer inflate numbers. |
| **New conv counting (NC-1/NC-2)** | New conversations grouped by `last_visitor_message_at` (first real interaction), not `created_at` (WS connect). Bot-only conversations excluded from agent new-conv count. |
| **Resolved chart correctness** | Resolved conversations grouped/filtered by `resolved_at`, not `updated_at`. |
| **Tag chart timing** | Tag chart now attributes to conversation `created_at`, not tag-application date. |
| **Bot filter + KPI split** | `analytics_overview` always returns `{agent: KpiMetric, bot: KpiMetric}` shape. Frontend shows `SplitKpiCard` for New Conversations, Resolved Conversations, and Avg First Response. |
| **Bot tab** | New "Bot" tab with 3 summary cards and 2 daily area charts (purple palette). |
| **Export columns** | 26-column Excel report: Chat Duration (mins), Agents (merged deduplicated), Lead Source (utm_source/direct), Referrer, Contact Filled, Rating Feedback, Visitor Messages, Agent Messages, Resolved At, description row. |
| **Export ghost exclusion** | Export query filters `last_visitor_message_at IS NOT NULL`. |
| **Chat duration in SQL** | Duration computed via `extract(epoch, resolved_at - date_with_time)` to avoid Python timezone arithmetic issues. |

### Rating System Fixes ✅ COMPLETE

| Fix | Detail |
|-----|--------|
| **Rating popup on reload** | `_shouldShowRatingPrompt(conv)` checks `status=resolved`, `closed_by≠bot`, `!is_rated`. Fires after `enterThreadView` for closed thread paths in `init()`. `renderConvList` `openFn` also checks and prompts when opening past convs. |
| **HTTP fallback was broken** | `CONFIG.serverUrl` was undefined — HTTP fallback silently crashed. Fixed to use `CONFIG.apiUrl`. WS path skipped for `isReadOnlyThread` (resolved-conv WS loop rejects `submit_rating`). |
| **Rating saved via HTTP** | `/ratings/submit` is now `async def`, calls `orchestrator.visitor_rated()` + broadcasts `visitor_rated` to agents after saving to DB. |
| **Rating feedback as bot message** | `visitor_rated(feedback=)` adds a second `is_agent_only=True` bot message (`Visitor comment: "..."`) and broadcasts `system_message` to agents for real-time display. |
| **WS handlers pass feedback** | Both `submit_rating` WS handlers (route 1 and route 2) pass `feedback_val` to `orchestrator.visitor_rated()`. |
| **Close button fixed** | Rating popup ✕ always dismisses without submitting — only Submit button sends. |

### Push Notification Fixes ✅ COMPLETE

| Fix | Detail |
|-----|--------|
| **New chat URL** | `_broadcast_new_chat_to_agents` was sending `url="/dashboard/chats"` — clicking opened the list. Fixed to `url=f"/dashboard/chats/{conversation.short_id}"` so notification click lands on the specific conversation. |

### Resolved Filter Real-time Update ✅ COMPLETE

| Fix | Detail |
|-----|--------|
| **Resolved list stale on agent-resolve** | `conversation_closed` WS event now increments `resolvedRefreshCounter` state, which is included in the resolved chats fetch key. List refetches immediately when a conversation is resolved, no full page reload needed. |

### Widget Improvements ✅ COMPLETE

| Fix | Detail |
|-----|--------|
| **Rating popup UI** | Selected emoji shows `box-shadow` ring (not oversized border). Textarea explicit light/dark styles. Submit button. |
| **Rating feedback textarea** | Widget rating popup: select emoji → feedback textarea appears → click Submit. Feedback sent alongside rating. |

### PWA Install Button ✅ COMPLETE

| Fix | Detail |
|-----|--------|
| **Install App sidebar button** | `usePwaInstall` hook wraps `beforeinstallprompt`. Download icon appears in desktop sidebar bottom actions and mobile sidebar footer. Hidden when already in standalone mode or browser doesn't support PWA install. |

---

## Descoped — Won't Fix (2026-07-16)

Not completed — deliberately decided against. Kept here (not deleted) so the original write-up and reasoning aren't lost if revisited later.

| # | Title | Description | Priority | Why descoped |
|---|-------|-------------|----------|---------------|
| SEC3 | **Separate session identifier from session credential** | The actual structural fix. Generate a second random secret alongside `session_id` at first connect, store both in the widget's localStorage entry, and require *both* (not just session_id) to open a WS or read history. Never return the secret in any agent-facing API response. `session_id` is trusted as the sole credential across 2 WS routes and 5 REST routes today — a real fix means threading the secret through all of them at once, plus a soft-migration path so no currently-connected live visitor gets locked out (issue a secret transparently on first connect if one's missing, only start hard-rejecting once one has actually been issued). Real auth-model change — scope as its own piece of work. | Medium | Decided not needed. |
| SEC5 | **Add session idle-expiry** | Connect/read rate-limiting shipped 2026-07-09 (IP-keyed, fails open if Redis is down). Remaining: a leaked/idle session_id never expires. Note: the "24h inactivity auto-close" precedent originally cited here is dead code — `_run_auto_close`/`_run_auto_resolve_visitor_ended` in `auto_close_scheduler.py` are never registered with the live APScheduler instance (only two unrelated notification jobs are), and even if they were, they resolve the *conversation*, not the session_id, so it would keep granting history access regardless. Building this would mean designing fresh expiry semantics, not reviving that job. | Low | Explicitly declined — no expiry wanted. |
| SEC6 | **Fix silent-skip session checks + unauthenticated rating read** | Surfaced while investigating SEC1-5, not yet fixed. `POST /ratings/submit` and the forms-submission route (`backend/app/api/forms.py`) only cross-check `session_id` against the conversation *if the field is supplied at all* — omitting it skips the check entirely, worse than blind trust. Separately, `GET /widget/conversations/{conversation_id}/rating` (`widget.py`) has no session_id/website check whatsoever — any conversation's rating is readable by ID alone. | Medium | Decided not needed. |
