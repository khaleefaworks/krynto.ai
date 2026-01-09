# Production Roadmap (MVP → Production)

Date: 2026-01-09

This document captures the agreed plan to move AI ChatAssist from an MVP to a production-ready system.

## Current Snapshot

Strengths:
- Clean separation at a high level: FastAPI backend + React dashboard + vanilla JS widget.
- Conversation/message persistence exists; websocket and REST APIs are both used.
- Message semantics improved via `sender_type` + `event_type` and UI differentiation.

Known MVP shortcuts / risks:
- Realtime state relies heavily on in-memory maps (presence, active agents, active visitors). This breaks with multi-worker/multi-instance deployments and resets on server restart.
- Production configuration is not locked down (e.g., CORS allows `*` in backend).
- Frontend and widget have development defaults (e.g., localhost base URLs), but support env/script-derived base URLs for production.
- Alembic history has been fragile (missing revisions previously). Production should rely on migrations only; avoid any runtime DDL.
- Duplicate logic exists across endpoints (e.g., sender resolution, message payload enrichment).
- WebSocket topology includes both global and per-website agent sockets, increasing duplication risk.
- Limited automated test coverage / CI gates.

Additional gaps found during repo scan (actionable):
- JWT reset invalidation is intended but likely ineffective: token `iat` is checked in WS/HTTP auth, but token issuance does not currently include `iat`.
- CORS currently includes `*` while `allow_credentials=true` (unsafe and browser-incompatible). Must be env-driven.
- Widget base URL derivation must be based on the widget script origin (or explicit data attributes), not the visitor site origin.
- CI exists in `.github/workflows/ci.yml` (backend compile/tests + frontend lint/build) and backend dependencies are constrained via `backend/requirements.lock.txt`.
- Frontend dependency versions differ from PRD assumptions (e.g., React version drift). Treat docs as descriptive, not authoritative.

## Status (as of 2026-01-09)

Phase 0 (Hardening):
- Done:
  - Env-driven CORS/origins (no wildcard + credentials).
  - JWT issuance includes `iat` (supports reset invalidation logic).
  - Runtime DDL/schema guards removed; deploy expects migrations.
  - Widget/frontend support non-localhost bases (env-driven + script-derived base); dev fallbacks may still point to localhost.
  - Upload validation hardened (type/size/content checks; block risky types).
  - Alembic history stabilized enough for `alembic upgrade head` on mixed/dirty DBs (idempotent migrations + merge head).
  - CI added (backend tests + frontend lint/build) and backend dependency constraints/lock strategy.
  - Production runbook created (single run command + env checklist): `docs/PRODUCTION_RUNBOOK.md`.
- Deployment decision (open):
  - Docker vs no-Docker packaging is not yet finalized.
- Still pending:
  - Choose deployment model (Docker vs no-Docker) and add the corresponding Nginx + process manager artifacts.

Phase 1 (Architecture cleanup):
- Next up (starting now): centralize sender resolution + message enrichment into a shared helper used by REST + WS paths.

## Guiding Principles

- One source of truth for schema: Alembic migrations only; no runtime DDL changes.
- One source of truth for message/event DTOs: versioned, shared contracts.
- Scale-safe realtime: no in-memory reliance for presence/routing if horizontal scaling is a goal.
- Configuration must be environment-driven and secure by default.
- Add observability + tests as we refactor to reduce regressions.

## Phase 0 — “Safe to Deploy” Hardening (1–2 days)

Goal: eliminate unsafe defaults and deployment foot-guns.

1) Config & environment
- Remove wildcard CORS and make allowed origins env-driven (dev vs prod).
- Eliminate hardcoded localhost URLs; use `VITE_API_BASE`, `VITE_WS_BASE`, and backend-provided widget config.
- Ensure `SECRET_KEY` has no insecure default in production.
- Ensure JWT issuance includes `iat` if reset invalidation is relied upon.
- Ensure widget loader uses backend public base URL (from request or explicit env), not visitor `window.location`.

2) Database migration hygiene
- Remove startup schema guards (ALTER TABLE on startup).
- Require `alembic upgrade head` in deploy process.
- Audit alembic heads and ensure one consistent linear history.
- Remove/resolve any "missing revision placeholder" migrations so the chain is trustworthy.

3) Security baseline
- Review upload endpoints: file size/type checks, path traversal safety, content-type, safe static serving.
- Ensure rate limiting is correctly applied and production-safe.
- Ensure JWT settings are production-safe (expiration, invalidation policy, storage guidance).

4) Operational basics
- Provide production server run command (uvicorn/gunicorn settings).
- If Docker is chosen: add docker-compose for local-prod parity.
- If no Docker is chosen: add systemd/supervisor + Nginx guidance for local-prod parity.
- Add CI minimum gates: backend tests + frontend lint/build.
- Pin backend Python dependencies (lock strategy).

## Phase 1 — Architecture Cleanup (3–7 days)

Goal: make the codebase predictable and maintainable.

Backend target layering (recommended):
- `app/api/` (routing, request/response schemas)
- `app/domain/` (entities, enums, pure rules)
- `app/services/` (use-cases/orchestration — e.g. ConversationOrchestrator)
- `app/repos/` (DB queries, persistence layer)
- `app/infra/` (websocket managers, storage, queue, integrations)

Concrete refactors:
- Centralize sender resolution and message enrichment into shared helpers.
- Standardize one Message DTO for widget + dashboard (versioned if needed).
- Delete/trim dead code per docs/WEBSOCKET_ANALYSIS.md (e.g., unused managers) after verifying imports.

## Phase 2 — Realtime & Presence That Scales (1–2 weeks)

Goal: “Smartsupp-like” reliability and multi-worker readiness.

Presence:
- Persist heartbeat to DB (`users.last_heartbeat_at` or a device table `agent_devices`).
- Compute presence from DB heartbeat TTL + grace period.

Current implementation note:
- Heartbeat-based presence is now designed to be DB-backed (survives restarts, supports multi-worker presence).
- Message delivery/routing is still in-memory (`AgentService.active_agents`, `ChatService.active_visitors`) and therefore single-worker only until Redis Pub/Sub (or similar) is introduced.

WebSocket scaling:
- Introduce Redis Pub/Sub (or similar) as the event bus so any worker can deliver events.
- Consider collapsing agent sockets to a single authenticated connection to avoid duplicate delivery.
- Ensure visitor socket routing works across instances.

## Phase 2.5 — Agent Availability (PWA / Mobile) (3–7 days)

Goal: increase the chance an agent is reachable and reduce “false offline” when a browser tab closes.

Scope (see `docs/PWA_PLAN_OF_ACTION.md` for implementation notes):
- Make the Agent Dashboard installable as a PWA (complete manifest + service worker).
- Presence should be based on heartbeat TTL + grace window (multi-device friendly).
- Add Web Push notifications (VAPID) for new visitor messages when the app is backgrounded.
- Ensure dashboard UX is practical on mobile (responsive layout + deep link to conversation).

## Phase 3 — Observability & Operability (3–5 days)

Goal: operate this like a production system.

- Structured logging everywhere (with request IDs).
- Metrics (Prometheus): ws connections, message rates, latency, errors.
- Error reporting (Sentry) for backend + frontend.
- Health endpoints: liveness + readiness (DB/Redis/vector store connectivity).

## Phase 4 — Quality Gates (start now, ongoing)

Backend:
- Add pytest coverage for key flows (auth, message routing, automation, presence).
- Add websocket integration tests for the critical chat flows.

Frontend:
- Keep eslint; add minimal tests around socket handlers and message rendering.

CI:
- Lint/format/typecheck + tests + frontend build on each PR.

## Open Decision (Impacts Architecture)

- Deployment model: single process/server vs multiple workers/containers (horizontal scaling).
  - If multi-worker is required, Phase 2 is mandatory and must be prioritized earlier.

## Suggested Next Step (when resuming)

Start Phase 0:
1) Lock down CORS and environment-based config.
2) Remove runtime schema guard and stabilize alembic.
3) Remove hardcoded localhost URLs in widget loader and agent socket.
