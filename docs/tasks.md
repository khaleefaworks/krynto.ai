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
| W2 | **Team routing notification dedup** | When switching pages with team-routed conversations, widget notification plays repeatedly. Cap at max 2-3 plays per message. | Medium |
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

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU3 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |
