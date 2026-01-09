# Production Runbook

Date: 2026-01-09

This is the minimal, actionable guide to run AI ChatAssist safely in production.

## Assumptions

- You will run the backend with **migrations applied** (Alembic).
- You will serve the frontend as static assets (built via Vite) behind a reverse proxy.
- TLS termination and domain routing are handled by a reverse proxy (e.g., Nginx).

## Required Environment Variables (Backend)

Set these in the backend environment (systemd unit / supervisor / container env):

- `ENV=production`
- `DATABASE_URL=postgresql+psycopg2://...`
- `SECRET_KEY=<strong random secret>`
- `CORS_ALLOWED_ORIGINS=https://dashboard.example.com,https://www.example.com`

Recommended:
- `PUBLIC_BASE_URL=https://api.example.com` (used for widget snippet generation)

Notes:
- In production, the backend will refuse to start if `SECRET_KEY` is empty or if `CORS_ALLOWED_ORIGINS` is empty.
- Do **not** include `*` in CORS origins when `allow_credentials=true`.

## One-time Setup

1) Create database and user
- Provision PostgreSQL and create the target database/user.

2) Install dependencies
- Use the pinned lock strategy already in the repo (see `backend/requirements.lock.txt`).

3) Apply migrations
- From `backend/`:
  - `alembic upgrade head`

## Run Command (Backend)

### Option A (recommended): gunicorn + uvicorn worker

From the repo root:

- `PYTHONPATH=backend gunicorn -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:8000 app.main:app`

Notes:
- Start with `-w 2` and tune based on CPU/RAM.
- WebSocket delivery/routing is currently **single-worker** (in-memory maps). For multi-worker WebSocket routing, Redis Pub/Sub (Phase 2) is required.

### Option B (simple): uvicorn

- `PYTHONPATH=backend uvicorn app.main:app --host 0.0.0.0 --port 8000`

## Migrations on Startup (Optional)

The repo includes `backend/start_server.sh` which supports:

- `RUN_MIGRATIONS=1 ./backend/start_server.sh`

This is convenient for small deployments but still assumes migrations are the source of truth.

## Frontend Build + Serve

From `frontend/`:

- `npm ci`
- `npm run build`

Serve `frontend/dist/` via Nginx (or equivalent).

## Reverse Proxy (Nginx) Notes

- Proxy `/` to the static frontend.
- Proxy `/api` (or your chosen prefix) to the backend.
- Ensure WebSocket upgrade headers are enabled for `/ws/*` routes.

## Health Check

- Backend health endpoint: `GET /health`

## Known Limitations (Current)

- Presence is DB-backed via heartbeat TTL.
- Message delivery/routing is still in-memory (`AgentService.active_agents`, `ChatService.active_visitors`), so true horizontal scaling requires Redis (Phase 2).
