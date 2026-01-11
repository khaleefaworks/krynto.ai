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

## In Progress / Next

### Phase 2 — Realtime & Presence that scales
- Ensure visitor ↔ agent realtime routing is multi-worker safe in all paths
- Consider collapsing/streamlining agent sockets if duplication risk remains

### Phase 2.5 — Agent availability (PWA / Push)
- PWA installability + background notifications

### Phase 3 — Observability
- Metrics + structured logging coverage, readiness/liveness checks

### Phase 4 — Quality gates
- Expand test coverage + CI hardening

## Recent commits (reference)
- `ceaaffd` Fix unread UX and widget welcome automation
- `a64defa` Fix WebSocket auth timezone mismatch
