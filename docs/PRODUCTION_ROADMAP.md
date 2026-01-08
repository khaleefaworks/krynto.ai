# Production Roadmap (MVP → Production)

Date: 2026-01-08

This document captures the agreed plan to move AI ChatAssist from an MVP to a production-ready system.

## Current Snapshot

Strengths:
- Clean separation at a high level: FastAPI backend + React dashboard + vanilla JS widget.
- Conversation/message persistence exists; websocket and REST APIs are both used.
- Message semantics improved via `sender_type` + `event_type` and UI differentiation.

Known MVP shortcuts / risks:
- Realtime state relies heavily on in-memory maps (presence, active agents, active visitors). This breaks with multi-worker/multi-instance deployments and resets on server restart.
- Production configuration is not locked down (e.g., CORS allows `*` in backend).
- Hardcoded localhost assumptions exist in widget and frontend WS paths.
- Alembic history has been fragile (missing revisions previously) and a runtime schema guard exists (ALTER TABLE at startup) — this is not acceptable for production.
- Duplicate logic exists across endpoints (e.g., sender resolution, message payload enrichment).
- WebSocket topology includes both global and per-website agent sockets, increasing duplication risk.
- Limited automated test coverage / CI gates.

Additional gaps found during repo scan (actionable):
- JWT reset invalidation is intended but likely ineffective: token `iat` is checked in WS/HTTP auth, but token issuance does not currently include `iat`.
- CORS currently includes `*` while `allow_credentials=true` (unsafe and browser-incompatible). Must be env-driven.
- Widget loader/snippet and dashboard sockets have hardcoded `localhost` base URLs; widget loader currently derives protocol from the *visitor site* (via `window.location`) which is incorrect for production.
- No Dockerfile / docker-compose / CI workflows detected; Python dependencies are not pinned.
- Frontend dependency versions differ from PRD assumptions (e.g., React version drift). Treat docs as descriptive, not authoritative.

## Status (as of 2026-01-08)

Phase 0 (Hardening):
- Done:
  - Env-driven CORS/origins (no wildcard + credentials).
  - JWT issuance includes `iat` (supports reset invalidation logic).
  - Runtime DDL/schema guards removed; deploy expects migrations.
  - Hardcoded `localhost` removed from widget/frontend bases (env-driven + backend public base).
  - Upload validation hardened (type/size/content checks; block risky types).
  - Alembic history stabilized enough for `alembic upgrade head` on mixed/dirty DBs (idempotent migrations + merge head).
  - CI added (backend tests + frontend lint/build) and backend dependency constraints/lock strategy.
- Deferred (explicit constraint):
  - Dockerfile / docker-compose local-prod parity (user requested no Docker files).
- Still pending:
  - Document a single “production run command” for the backend (gunicorn/uvicorn guidance + env checklist).

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
- Add a docker-compose (or equivalent) for local-prod parity.
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

WebSocket scaling:
- Introduce Redis Pub/Sub (or similar) as the event bus so any worker can deliver events.
- Consider collapsing agent sockets to a single authenticated connection to avoid duplicate delivery.
- Ensure visitor socket routing works across instances.

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
