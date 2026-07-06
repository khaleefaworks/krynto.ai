# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native or PWA** | Mobile app for agents. Low priority. Requires pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Push Notifications & Widget

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| PN1 | ~~**New chat notification repeats until claimed**~~ | ✅ Done — redefined from the original "staggered bot message" description. `_broadcast_new_chat_to_agents` re-fires (WS + push) until an agent joins, the conversation resolves, or the visitor ends the chat. Refined: (1) pauses while the visitor is actually disconnected, auto-resumes on reconnect (checks `ChatService.active_visitors` each tick); (2) the repeat interval + on/off switch is the `new_chat_unclaimed` automation trigger (cooldown_seconds) — now auto-seeded (enabled, 15s) for every website, same as the other default automations; (3) repeat pushes say "Chat waiting to be claimed" instead of reusing the "New chat" wording. Also fixed: default-automation seeding (`ensure_default_automations_for_website`) was dead code since Apr 2026 (never wired into `create_website`) — restored, and made non-destructive (only backfills missing defaults, never overwrites customized ones like Team routing chatbot's buttons). Also fixed: chat panel's visitor online dot now reads the same session-level presence (`ChatService.is_session_online`) everywhere (WS push + REST snapshot), instead of two different, sometimes-inconsistent sources. | Medium |
| PN2 | ~~**Visitor rejoin push notification**~~ | ✅ Done — implemented as a generic `show_notification` toggle on automation `emit_system_event` nodes (reusable for any future node/trigger), turned on for the "Visitor dropped event" and "Visitor reconnected" seed automations. Plays each agent's own "message" sound preference + sends push, same as a regular message. New websites get it by default; existing orgs (e.g. org 1) need to flip the toggle once in Settings → Automations. | Medium |
| W1 | ~~**Widget new message popup styling**~~ | ✅ Done — popup shrunk (300px→272px, tighter padding/avatar/close button, shorter body max-height) and launcher pill tightened (icon 40→36px, text 15→14px) on all screen sizes. On mobile (≤480px) the "Chat with us" text label is hidden entirely (icon + unread badge only) and the popup width becomes viewport-relative instead of a fixed 300px. Desktop keeps the text label. Widget-only change — verified visually via rendered screenshots at 800px and 375px. | Medium |
| W2 | ~~**Welcome popup repeats on every page nav**~~ | ✅ Done — redefined from the original "team routing notification dedup" description. Actual issue: the proactive welcome popup was only silenced by an explicit "x" dismissal (12h cooldown); a visitor who never clicked it got the same popup — sound, unread bump, all — on every single page navigation, since each page load replays history and re-triggers the "hasn't sent a message yet" re-show path. Added a shown-count cap (industry-standard proactive-message pattern): shows at most twice per 12h rolling window (same window as the dismissal cooldown), then stays silent until it rolls over — same as if explicitly dismissed. Doesn't affect genuine new-message notifications (agent replies, new bot messages), only the recurring welcome greeting. | Medium |
| W3 | ~~**"Connecting to agent..." indicator**~~ | ✅ Done — rotating reassurance text ("Connecting you to an agent…" → "Hang tight, almost there…" → "Thanks for your patience…", every 3.5s) in the same spot as "Agent is typing". Shows only after the visitor has actually engaged (message sent or leaf button committed) and a real agent is expected — suppressed for bot-only informational paths (e.g. Careers → New Application/Check Status, where `automation_complete.allow_input=false`) and while the offline contact-form overlay is up. Hides for good once `agent_joined` fires; correctly re-derived from history on reload. Verified end-to-end in a real headless-browser session against the live backend (not just code review). | Medium |

## Availability & Status

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AV1 | ~~**Agent offline warning on send**~~ | ✅ Done (d2ceb97) — agent sees a confirmation popup before send/join while offline instead of silent auto-toggle. | High |

## Automations & Reporting

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU1 | **Automation for bot message delay (1+ min)** | Create automation trigger for bot messages that take longer than 1 minute to complete (e.g., waiting for external API response). Low priority — deferred feature. | Low |
| AU2 | **Automation for missed chats** | Trigger automation when a conversation is not assigned within a certain time window (e.g., 5 min of visitor message). Can route to escalation or offline handling. | Medium |
| REP1 | **Chat timing accuracy issue** | Report: Conversation initialization and resolving times are not accurate. Investigate whether `created_at`, `resolved_at`, and other timestamps are set correctly throughout the lifecycle. | Medium |

## Visitor Contact Capture

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| CC1 | **Structured contact capture during a live (online) chat** | Today, contact info only gets captured cleanly when all agents are offline (structured form → `conversations.visitor_name/visitor_email/visitor_phone`, shown in `VisitorDetailsPanel`). When agents are online they just ask in chat, and visitors reply in free text ("ragul7708196644, Ragul, 7708196644") that nothing parses — agents have to manually retype it into the panel's edit fields. Decided approach: **agent-triggered inline "contact card"** in the chat thread (same industry-standard pattern as Intercom/Drift/Crisp's "collect visitor info" step), not regex-parsing free text (unreliable for phone/name, and a wrong silent auto-fill is worse than an empty field). Reuses a lot of existing plumbing: the `visitor_contact` WS message type already fills only-empty `conversations.visitor_*` columns (backend/app/api/ws_chat.py); the `bot_prompt_buttons` message type already proves the "enriched JSON message content, decoded by `message_presenter.py`, rendered as a real interactive widget instead of a text bubble" pattern; the offline contact-overlay's form UI/validation (name/phone digit-stripping/email regex) can be reused as the card's rendering; the agent-side trigger fits naturally next to the existing `/shortcut` mechanism in `ChatComposer.tsx` (e.g. a `/contact` trigger or a composer icon). New work: a new `event_type` for the card message, the widget-side renderer (smaller sibling of `appendBotPromptWithButtons`), and the agent trigger UI. Optional low-cost follow-up: a passive, non-committal "detected phone/email in recent messages — apply?" suggestion chip in the visitor panel as a backstop for agents who skip the card — never silently auto-filled. | Medium |

## Security

Found 2026-07-06: an agent can copy a visitor's `session_id` (visible as a full, untruncated tooltip + searchable text in `CustomersVisitors.tsx`) into their own browser's `ai_chatassist_session_id_{websiteId}` localStorage key and gain full read/write access to that visitor's conversation. Root cause: `session_id` is used as both the public identifier *and* the sole bearer credential for a conversation — classic identifier/secret conflation. Investigation found the blast radius is wider than the original report: `chat_ws_with_conversation` (the WS route used for virtually every reconnect after the first message) has **no Origin/Referer check at all**, unlike `chat_ws` — so this isn't limited to "an agent on the actual site," anyone anywhere who obtains `website_id`+`session_id`+`conversation_id` can connect directly. No rate limiting on connects/history-reads (only on message sends), no session expiry/rotation, and the session_id itself is generated with `Math.random()` rather than `crypto.randomUUID()` (inconsistent with the rest of the widget).

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| SEC1 | **Add domain-lock check to `chat_ws_with_conversation`** | Copy the same Origin/Referer enforcement (`enforce_widget_domain_or_403`/`get_widget_request_host`/`is_host_allowed_for_website`) that `chat_ws` already has (backend/app/api/ws_chat.py) onto `chat_ws_with_conversation`, which currently has none. Doesn't stop same-domain session_id replay, but closes the "hijack from anywhere on the internet" escalation. Small, mechanical, reuses existing code. | High |
| SEC2 | **Stop exposing full session_id in the dashboard** | `CustomersVisitors.tsx` renders the complete, untruncated session_id as an HTML tooltip and includes it in full-text search — this is the exact vector used to demonstrate the hijack, no devtools needed. Replace with the `shortSessionId()` helper already used elsewhere in the same file for display; stop returning/rendering the raw value where it isn't strictly required. | High |
| SEC3 | **Separate session identifier from session credential** | The actual structural fix. Generate a second random secret alongside `session_id` at first connect, store both in the widget's localStorage entry, and require *both* (not just session_id) to open a WS or read history. Never return the secret in any agent-facing API response. Means a fully-exposed session_id (visible to agents, logged, whatever) stops being sufficient on its own. Real auth-model change — scope as its own piece of work, don't bundle with SEC1/SEC2. | Medium |
| SEC4 | **Use `crypto.randomUUID()` for session_id generation** | `widget/chat-widget.js`'s `getSessionId()` builds a UUID-shaped string via `Math.random()` instead of `crypto.randomUUID()`, which the same file already uses correctly for message IDs and attachment IDs. Inconsistent, lower-grade randomness. Small fix, bundle with SEC3 since both touch session creation. | Low |
| SEC5 | **Rate-limit connects/history-reads, add session expiry** | Defense in depth. Today's rate limiter (`backend/app/infra/ws_rate_limit.py`) only throttles outgoing chat messages per session — someone scripting `/widget/read-state` or `/widget/conversations` with a harvested session_id can scrape at any speed with no throttle, and a leaked session_id never expires. Add per-session_id/IP rate limiting on connect/read endpoints, and an idle-expiry for sessions (there's already a precedent pattern: resolved conversations expire after 24h inactivity). | Low |

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU3 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |
