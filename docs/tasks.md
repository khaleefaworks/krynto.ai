# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native or PWA** | Mobile app for agents. Low priority. Requires pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Push Notifications & Widget

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| PN1 | ~~**New chat notification repeats until claimed**~~ | ✅ Done — redefined from the original "staggered bot message" description. `_broadcast_new_chat_to_agents` re-fires (WS + push) until an agent joins, the conversation resolves, or the visitor ends the chat. Refined: (1) pauses while the visitor is actually disconnected, auto-resumes on reconnect (checks `ChatService.active_visitors` each tick); (2) the repeat interval + on/off switch is now the `new_chat_unclaimed` automation trigger (cooldown_seconds), not hardcoded — existing orgs (e.g. org 1) need to add that automation once via Settings → Automations to enable repeats, same manual step as PN2; (3) repeat pushes say "Chat waiting to be claimed" instead of reusing the "New chat" wording. | Medium |
| PN2 | ~~**Visitor rejoin push notification**~~ | ✅ Done — implemented as a generic `show_notification` toggle on automation `emit_system_event` nodes (reusable for any future node/trigger), turned on for the "Visitor dropped event" and "Visitor reconnected" seed automations. Plays each agent's own "message" sound preference + sends push, same as a regular message. New websites get it by default; existing orgs (e.g. org 1) need to flip the toggle once in Settings → Automations. | Medium |
| W1 | **Widget new message popup styling** | Reduce popup size and button size. Remove "chat" label on mobile to save space. | Medium |
| W2 | **Team routing notification dedup** | When switching pages with team-routed conversations, widget notification plays repeatedly. Cap at max 2-3 plays per message. | Medium |
| W3 | **"Connecting to agent..." indicator** | Show "Connecting to agent..." status in the same location where "Agent is typing..." appears, when agent is joining the conversation. | Medium |

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
