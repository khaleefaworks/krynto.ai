# AI ChatAssist — Task Tracker

Last updated: 2026-01-12

This file summarizes the tasks we planned in the long chat thread and their current status.

## Completed

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
- Fixed WS/HTTP auth timezone mismatch that could crash WS auth and cause abnormal close `1006` loops (restores stable realtime sockets)

### Production readiness (Jan 2026)
- Liveness + readiness probes: `/health/live` and `/health/ready` (DB + optional Redis check)

## In Progress / Next

### Phase 2 — Realtime & Presence that scales
- [x] Redis Pub/Sub realtime bus implemented (optional; enabled when `REDIS_URL` is set)
- [x] Visitor delivery supports Redis bus (`visitor_direct`)
- [x] Agent delivery supports Redis bus (`agent_direct` + `agent_broadcast`)
- [x] Single global agent socket model (dashboard connects to `/ws/agent/0` only)


- [x] Phase 2.1 — Remove deprecated FastAPI lifecycle hooks
	- Replace `@app.on_event("startup"/"shutdown")` with FastAPI lifespan handlers

- [x] Phase 2.2 — Multi-worker routing verification suite
	- Add unit tests for `ChatService.deliver_bus_event()` (symmetry with agent tests)
	- Add unit tests for `AgentService.send_to_agent()` local-delivery path
	- Add explicit test coverage that bus events are schema-tolerant (missing fields)


- [x] Phase 2.3 — Redis “required in prod when multi-worker” guardrails
	- Document: if running `gunicorn -w > 1`, set `REDIS_URL`
	- Add startup log line that states whether bus is enabled


- [x] Phase 2.4 — Connection hygiene
	- Confirm visitor socket unregister on disconnect always runs
	- Confirm agent socket unregister on disconnect always runs

### Phase 2.5 — Agent availability (PWA / Push)
	- [x] Phase 2.5.1 — PWA installability
	- Validate `site.webmanifest` + icons + service worker strategy (Vite)
	- Ensure HTTPS-only requirements are documented


- [x] Phase 2.5.2 — In-app notifications (dashboard)
	- Use existing global agent socket events (`new_chat`, `visitor_message`, `conversation_unread`)
	- Add a single notification surface (toast or badge list) and wire it to events


- [x] Phase 2.5.3 — Push notifications (browser)
	- Web Push (VAPID) key management + subscription endpoint
	- Store per-agent subscriptions; send push on `new_chat` when agent is offline
	- Service worker receives push and shows notification


- [x] Phase 2.5.4 — Widget notifications
	- Decide scope: (A) only show “agent replied” badge in widget, or (B) Web Push for visitors
	- Implement chosen option without introducing AI features

### Phase 3 — Observability
- [x] Metrics + structured logging coverage
	- `/metrics` Prometheus-text endpoint (HTTP + WS)
	- Request correlation via `X-Request-ID` (HTTP) + per-WS connection correlation fields
- [x] Readiness/liveness checks

### Phase 4 — Quality gates
- Expand test coverage + CI hardening

- [x] Add unit tests for metrics registry rendering
- [x] Expand websocket flow integration tests (presence + error handling)

- [x] Add websocket tests for widget domain-lock rejection cases
	- Reject when request host is not allowed for website domain
	- Reject when origin is missing in production

- [x] Add websocket tests for page_view event semantics
	- Ensure `page_view` does not create a new conversation when none exists
	- Ensure it broadcasts to agents only when a conversation exists

- [x] Add websocket tests for rate limiting behavior
	- Verify fallback in-memory limiter when `REDIS_URL` is not set
	- Verify Redis limiter path is invoked when `REDIS_URL` is set (stubbed)

- [x] CI: run frontend typecheck explicitly
	- Add `npm run typecheck` script (tsc --noEmit) and run it in GitHub Actions

- [x] CI: add a minimal backend lint/format gate
	- Pick one tool (e.g., ruff) and run it in GitHub Actions with a minimal rule set

## Recent commits (reference)
- `ceaaffd` Fix unread UX and widget welcome automation
- `a64defa` Fix WebSocket auth timezone mismatch
- `4944a98` fix(visitors): move session presence to Redis for multi-worker consistency — I2 ✅
- `b601fd9` fix(frontend): prevent infinite chat spinner on direct URL navigation — I1 ✅

## Bug / improvement fixes (May 2026)

### I2 — Visitors page split-brain (✅ FIXED — `4944a98`)
- Root cause: per-worker in-memory `_session_presence` dict lost events across Gunicorn workers
- Fix: presence keys stored in Redis with TTL + heartbeat renewal

### I1 — Direct URL infinite spinner (✅ FIXED — `b601fd9`)
- Root cause: `loadChatData(showSpinner=false)` incremented `loadMessagesTokenRef`, causing
  the `showSpinner=true` finally-block token check to fail and leave `chatLoading` stuck
- Fix: separate `chatLoadingTokenRef` that only gets set when `showSpinner=true`

### A1+A2 — Analytics conversation miscounts (✅ FIXED)
Root causes:
1. `CONVERSATION_RESUME_CUTOFF_HOURS = 24` in `get_or_create_conversation` created a new row
   for every returning visitor after 24 h idle → row explosion (2103 rows in 7 days, most empty)
2. `auto_close_scheduler` bulk-closed conversations as `'inactivity'` / `'system_auto'` →
   inflated `total_resolved` and `resolved_conversations_chart` analytics

Fixes applied:
- **Removed 24 h cutoff** from `repos/conversations.py::get_open_conversation_by_session`
  and `services/conversation_service.py::get_or_create_conversation`
  → OPEN conversations now stay resumable until explicitly resolved
- **Disabled inactivity scheduler jobs** in `services/auto_close_scheduler.py`
  (`_run_auto_close` hourly + `_run_auto_resolve_visitor_ended` 30-min jobs removed from scheduler)
- **Analytics A1**: `total_new` + `new_conversations_chart` now filter
  `last_visitor_message_at IS NOT NULL` — excludes bounce / bot-only sessions
- **Analytics A2**: `total_resolved` + `resolved_conversations_chart` now exclude
  `closed_by IN ('inactivity', 'system_auto')` — historical scheduler closures no longer inflate count
- **Race condition guard**: `IntegrityError` handling added around the INSERT in
  `get_or_create_conversation`; partial unique index
  `conversations_open_session_unique ON conversations(website_id, session_id) WHERE status='open'`
  ensures at most one OPEN row per session
- **Dead column cleanup**: `conversations.mode` (orphan, not in model) and `conversations.title`
  (always NULL, auto-generation removed) dropped via migration `c7d8e9f0a1b2`

### DB schema audit tool (✅ NEW — `backend/db_audit.py`)
- `bench trim-tables`-style CLI for this project
- Detects orphaned columns (DB-only), always-null columns, ghost tables
- Supports `--null-threshold`, `--generate-sql`, `--execute`
- See `backend/README.md § Database schema audit` for full usage
