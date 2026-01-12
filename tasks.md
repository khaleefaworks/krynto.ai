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

- [ ] CI: run frontend typecheck explicitly
	- Add `npm run typecheck` script (tsc --noEmit) and run it in GitHub Actions

- [ ] CI: add a minimal backend lint/format gate
	- Pick one tool (e.g., ruff) and run it in GitHub Actions with a minimal rule set

## Recent commits (reference)
- `ceaaffd` Fix unread UX and widget welcome automation
- `a64defa` Fix WebSocket auth timezone mismatch
