# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native or PWA** | Mobile app for agents. Low priority. Requires pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

---

## Deferred Features

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| F3 | **Auto-Tag Agent on Assignment** (DEFERRED) | Auto-apply an agent-name tag on claim/takeover/manual-assign. Blocked: disambiguation problem — if two agents share the same first name (e.g. two "Johns"), they'd map to the same tag and make per-agent tag filters inaccurate. Design needed: e.g. "John S." / "John D." initials strategy, or use `agent:{user_id}` as tag key with display name as label. | Medium |
| F4 | **Auto-Tag Events: visitor_dropped / agent_offline** (DEFERRED) | Extend auto-tagging to fire on `visitor_dropped` and `agent_offline` events. Architecture already supports it via `get_or_create_tag` pattern. Deferred until F3 disambiguation is resolved. | Low |

---

## Feature Bugs

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| B2 | **Handler Mode — Agent Dashboard Bot Awareness** | The `bot_only` flag and Bot filter in `ConversationsView` are implemented (BOT1). What remains: **(1)** Agent dashboard: when a conversation is `bot_only=True` and still OPEN, show a "Bot is handling this conversation" banner and grey out the composer so agents don't accidentally interrupt the visitor's button-selection flow. **(2)** "Take Over" button: clicking it fires `automation_complete`, assigns the agent, and clears `bot_only`. **(3)** Optional: rename/repurpose the orphaned `mode` column (migration `48e25fb7e142`, never ORM-mapped) as a proper `handler_mode` enum if the above banner logic needs finer-grained states (`bot \| pending \| agent`). | High |

---

## Analytics Improvements

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AN1 | **Analytics — Bot filter + Excel report column descriptions** | Analytics page currently has no way to separate bot-handled (Careers, etc.) conversations from human/agent conversations. Needed: (1) Add a "Bot" filter option across all Analytics charts and summary cards so bot-only conversations (closed_by='bot') can be isolated or excluded. (2) Add per-filter breakdowns in the existing date/team/agent filter panels. (3) For the Excel/CSV export: add a header row describing each column (e.g. "Conversation ID", "Visitor Name", "Closed By", "Duration (minutes)", etc.) so the downloaded file is self-explanatory without needing a data dictionary. | Medium |

---

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU1 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |
