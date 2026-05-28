# Tasks

## Carried Over from bugs&features.md

| # | Item | Notes |
|---|------|-------|
| 40 | **Mobile app — native or PWA** | Mobile app for agents. Low priority. Requires pnpm monorepo migration first — see `docs/MONOREPO_PLAN.md` |

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
