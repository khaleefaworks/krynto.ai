# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native or PWA** | Mobile app for agents. Low priority. Requires pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Push Notifications & Widget

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| PN1 | **Bot message push notifications (staggered)** | When bot sends a message, send push notifications to agents at intervals: 10s, 30s, 60s, then every 10s thereafter (avoiding spam). Stagger multiple bot messages so they don't all fire at the same time. | Medium |
| PN2 | **Visitor rejoin push notification** | Send push notification when a visitor reconnects/rejoins during an ongoing conversation (e.g., refreshed page, returned from another tab). | Medium |
| W1 | **Widget new message popup styling** | Reduce popup size and button size. Remove "chat" label on mobile to save space. | Medium |
| W2 | **Team routing notification dedup** | When switching pages with team-routed conversations, widget notification plays repeatedly. Cap at max 2-3 plays per message. | Medium |
| W3 | **"Connecting to agent..." indicator** | Show "Connecting to agent..." status in the same location where "Agent is typing..." appears, when agent is joining the conversation. | Medium |

## Availability & Status

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AV1 | **Agent offline warning on send** | When an agent tries to send a message but they are offline (`is_available=False`), show a popup: "You are offline. Please go online to join/reply to this chat." Prevent the send action. | High |

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
