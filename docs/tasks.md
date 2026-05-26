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
| B2 | **Handler Mode — Bot/Agent/AI Conversation Ownership** | A conversation has no reliable field indicating who is currently handling it. When a chatbot flow is active, agents can still type free text from the dashboard, potentially interrupting the visitor's button-selection flow. There is also no "Bot" filter in the conversations list. **Fix (three-part):** (1) Add `handler_mode` enum column (`bot \| pending \| agent \| ai`) to the `conversations` table via Alembic migration (extends/replaces the orphaned `mode` column from migration `48e25fb7e142` which was never mapped in the ORM). (2) Orchestrator sets `handler_mode` at transition points: `bot` when `chatbot_flow` automation fires on `conversation_created`; `pending` on `automation_complete`; `agent` on claim/assign/takeover; `ai` reserved for future. (3) Agent dashboard: when `handler_mode == bot`, show a "Bot is handling this conversation" banner, grey out the composer, and show a "Take Over" button. Clicking Take Over fires `automation_complete`, assigns the agent, and sets `handler_mode = agent`. (4) Conversations API: add `?handler_mode=` filter param; return `handler_mode` in serialization. (5) `ConversationsView.tsx`: add `'bot'` to `FilterCategory`, add Bot entry in sidebar filter column. | High |

---

## Audit Trail

| # | Title | Description | Priority |
|---|-------|-------------|----------|
| AU1 | **Change History / Audit Log** | No change-history mechanism exists. Implement an `audit_logs` table: `id, table_name, record_id, action (create/update/delete), performed_by_user_id, performed_at, old_values (JSONB), new_values (JSONB)`. Register SQLAlchemy `before_flush` event listener on `Base` to diff dirty instances automatically. Surface per-record history in the UI for key entities (conversations, users, automations, websites). Scope: track mutations on `users`, `websites`, `organizations`, `automations`, `website_teams`, `agent_website_assignments`. Read-heavy tables (messages, events) are excluded. | Low |
