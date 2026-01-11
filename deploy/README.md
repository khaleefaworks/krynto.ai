# Deployment templates

These are **templates** for the two open deployment models mentioned in `docs/PRODUCTION_ROADMAP.md`:

- **No-Docker**: systemd + Nginx (templates included)
- **Docker**: not included here (decision still open)

This folder does not change runtime behavior; it only provides example configs.

## Option A: No-Docker (recommended starting point)

### 1) Backend (systemd)

- Copy and edit:
  - `deploy/systemd/aichatassist-backend.service`
  - `deploy/systemd/aichatassist-backend.env.example` → `/etc/aichatassist/backend.env`

- Apply migrations once:
  - `cd backend && alembic upgrade head`

- Enable service:
  - `sudo systemctl daemon-reload`
  - `sudo systemctl enable --now aichatassist-backend`

### 2) Nginx

Use one of the templates:

- `deploy/nginx/api.example.com.conf` (backend + `/ws/*`)
- `deploy/nginx/dashboard.example.com.conf` (frontend static)

Then:

- `sudo nginx -t && sudo systemctl reload nginx`

## Notes

- WebSocket routing is single-worker unless Redis Pub/Sub is enabled (`REDIS_URL`).
- Set production env vars exactly as described in `docs/PRODUCTION_RUNBOOK.md`.
