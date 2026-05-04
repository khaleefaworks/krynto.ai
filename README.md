# AI ChatAssist

Self-hosted, multi-tenant live chat platform. Visitors chat via an embeddable JS widget; agents respond in real time from a React dashboard.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy (sync), PostgreSQL, Alembic, WebSockets |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v3, Zustand v5, react-router-dom v7 |
| Widget | Vanilla JS (IIFE, zero dependencies) |
| Realtime | WebSockets (single worker) + Redis Pub/Sub (multi-worker) |
| Auth | JWT HS256 + bcrypt, 24 h TTL, iat-based invalidation |

## Repository layout

```
ai-chatassist/
├── backend/                  # FastAPI app — see backend/README.md
│   ├── alembic/              # DB migrations
│   ├── app/
│   │   ├── api/              # Routers (REST + WebSocket)
│   │   ├── core/             # Config, DB engine, security, limiter, logging
│   │   ├── infra/            # RealtimeBus (Redis Pub/Sub), metrics
│   │   ├── models/           # SQLAlchemy ORM models
│   │   ├── repos/            # Thin query functions (accept db: Session)
│   │   └── services/         # Business logic (ConversationOrchestrator, etc.)
│   ├── tests/                # ~20 pytest modules (SQLite in-memory)
│   ├── requirements.txt
│   └── start_server.sh
├── frontend/                 # React agent dashboard — see frontend/README.md
│   ├── public/
│   │   └── docs-content/     # End-user docs (.md files served as static assets)
│   └── src/
│       ├── components/       # Shared UI components
│       ├── config/           # API base URL, docsNav config
│       ├── lib/              # Role helpers, notification sounds
│       ├── pages/            # Route-level page components + layouts
│       ├── services/         # HTTP API clients + agentSocket singleton
│       └── store/            # Zustand stores (appStore, messages)
├── widget/                   # Embeddable visitor chat widget
│   ├── chat-widget.js        # Self-contained IIFE
│   ├── chat-widget.css
│   └── demo.html
├── deploy/                   # Nginx configs, systemd units, backup scripts
├── docs/                     # Internal planning documents
└── uploads/                  # Uploaded files (avatars, website assets)
```

## Architecture overview

```
Visitor browser          Agent browser            System Manager
     │                        │                        │
     │ WS /ws/chat/{id}        │ WS /ws/agent/0          │ HTTP /superadmin/*
     │ HTTP /widget/*          │ HTTP /dashboard/*        │
     └────────────────────────┴────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   FastAPI backend  │
                    │                   │
                    │  ConversationOrchestrator
                    │  ├── ChatService  (visitor WS registry)
                    │  ├── AgentService (agent WS registry)
                    │  ├── AutomationService
                    │  ├── AgentResolverService
                    │  └── WebsiteResolverService
                    └──────┬────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         PostgreSQL      Redis       uploads/
         (primary DB)  (optional     (static
                        Pub/Sub)      files)
```

**Multi-worker delivery:** each Gunicorn worker holds its own in-memory WS registries. Redis Pub/Sub (RealtimeBus) bridges cross-worker delivery. Single-worker deployments skip Redis entirely.

## Roles

```
SYSTEM_MANAGER  (org_id = NULL)  — platform-wide, /superadmin/* only
OWNER           (org scope)      — full org control
MANAGER         (org scope)      — manage agents + conversations
AGENT           (website scope)  — assigned websites only
```

---

## Quick Start (Local Development)

### Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the Repository](#2-clone-the-repository)
3. [Database Setup](#3-database-setup-postgresql)
4. [Backend Setup](#4-backend-setup)
5. [Frontend Dashboard](#5-frontend-dashboard)
6. [Widget Demo](#6-widget-demo)
7. [Optional Services](#7-optional-services)
8. [Health Checks](#8-health-checks)
9. [Running Tests](#9-running-tests)
10. [Reset Application](#10-reset-application-development-only)
11. [Troubleshooting](#11-troubleshooting)

---

### 1. Prerequisites

Install system dependencies (Ubuntu/Debian):

```bash
sudo apt update
sudo apt install -y git build-essential python3 python3-venv python3-pip nodejs npm postgresql postgresql-contrib
```

> **Tip:** Use [nvm](https://github.com/nvm-sh/nvm) to manage Node.js (LTS recommended).

Make sure PostgreSQL is running:

```bash
sudo systemctl enable --now postgresql
```

---

### 2. Clone the Repository

```bash
git clone <your-repo-url> ~/Applications/ai-chatassist
cd ~/Applications/ai-chatassist
```

---

### 3. Database Setup (PostgreSQL)

```bash
sudo -u postgres createuser -P chatassist       # enter a password when prompted
sudo -u postgres createdb -O chatassist chatassist
```

Verify connectivity:

```bash
psql "postgresql://chatassist:<your_password>@localhost:5432/chatassist" -c "SELECT 1;"
```

---

### 4. Backend Setup

#### 4.1 Create virtualenv and install dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.lock.txt || pip install -r requirements.txt
```

#### 4.2 Configure environment variables

```bash
cp .env.example .env
```

Open `backend/.env` and set **at minimum** these values:

| Variable | Example | Required? |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://chatassist:<password>@localhost:5432/chatassist` | **Yes** |
| `SECRET_KEY` | `dev-only-change-me` | **Yes** |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | **Yes** |
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | No (see [Redis](#73-redis)) |
| `VAPID_PUBLIC_KEY` | *(generated — see section 7)* | No |
| `VAPID_PRIVATE_KEY` | *(generated — see section 7)* | No |
| `RESEND_API_KEY` | *(from Resend dashboard)* | No (see [Email](#72-email-via-resend)) |

> See `backend/.env.example` for the full list of available keys and their defaults.

#### 4.3 Run migrations and start the server

**Option A — Auto-migrate on start (recommended):**

```bash
RUN_MIGRATIONS=1 ./start_server.sh
```

**Option B — Manual migrations then start:**

```bash
alembic upgrade head
./start_server.sh
```

`start_server.sh` performs preflight checks (virtualenv, DB connectivity) and starts Uvicorn on port **8000**.

> API docs: http://localhost:8000/docs

---

### 5. Frontend Dashboard

Open a **new terminal**:

```bash
cd frontend
npm ci
npm run dev
```

> Dashboard: http://localhost:5173

---

### 6. Widget Demo

Open a **new terminal**:

```bash
cd widget
python3 -m http.server 8080
```

> Widget demo: http://localhost:8080/demo.html

---

### 7. Optional Services

#### 7.1 Push Notifications (VAPID)

```bash
cd frontend
npx --yes web-push generate-vapid-keys
```

Copy the output into `backend/.env`:

```env
VAPID_PUBLIC_KEY=<generated-public-key>
VAPID_PRIVATE_KEY=<generated-private-key>
VAPID_SUBJECT=mailto:dev@localhost
```

Restart the backend after updating.

#### 7.2 Email via Resend

The app uses [Resend](https://resend.com) for transactional email (invites, OTP, password reset).

1. Sign up at https://resend.com and create an API key.
2. Add to `backend/.env`:

```env
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL="AI ChatAssist <noreply@yourdomain.com>"
FRONTEND_URL=http://localhost:5173
```

> **Custom domain (recommended):** Verify your domain in the Resend dashboard and use `noreply@yourdomain.com` as `FROM_EMAIL`. Email will be delivered to any recipient with no restrictions.

> **Shared test domain:** If you haven't verified a domain yet, use `FROM_EMAIL="AI ChatAssist <onboarding@resend.dev>"` and add `RESEND_OVERRIDE_TO_EMAIL=your-verified@email.com` to redirect all outgoing mail to your inbox.

#### 7.3 Redis

Redis enables WebSocket rate-limiting and multi-worker pub/sub. Without it the app uses in-memory mode (fine for single-process local dev).

```bash
# Install
sudo apt install -y redis-server
sudo systemctl enable --now redis-server

# Verify
redis-cli PING   # should return PONG
```

Set in `backend/.env`:

```env
REDIS_URL=redis://127.0.0.1:6379/0
```

---

### 8. Health Checks

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Basic liveness probe |
| `GET /health/ready` | Checks DB + Redis (if configured) |

```bash
curl http://localhost:8000/health/ready
```

> When `REDIS_URL` is not set, the response shows `"redis": "disabled"`.

---

### 9. Running Tests

From `backend/` with the virtualenv active:

```bash
pytest -q
```

Tests use SQLite in-memory — no PostgreSQL, Redis, or email services needed.

---

### 10. Reset Application (Development Only)

```bash
# Backup first
sudo -u postgres pg_dump -Fc -f backup.dump chatassist

# ⚠️ Destructive — deletes uploads, truncates tables, resets sequences
cd backend
source .venv/bin/activate
python3 reset_application.py            # interactive — type YES to confirm
python3 reset_application.py --seed     # reset + seed test data
```

---

### 11. Troubleshooting

| Problem | Fix |
|---|---|
| `start_server.sh` reports missing virtualenv | Create it: `python3 -m venv backend/.venv` |
| DB connectivity fails | Check `DATABASE_URL` in `.env`; verify Postgres is running |
| Email sending fails in dev | Set `RESEND_OVERRIDE_TO_EMAIL` when using Resend's shared test domain (`onboarding@resend.dev`); not needed with a verified custom domain |
| Frontend build errors | Delete `node_modules/` and run `npm ci` |
| Push notifications not working | Ensure VAPID keys are set in `.env` and backend is restarted |

---

## Production Deployment

See `deploy/` for Nginx configs and systemd service files.

### Server Layout

| Path | Purpose |
|---|---|
| `/home/frappe/ai-chatassist` | Git repo — single source of truth |
| `/home/frappe/ai-chatassist/.venv` | Python virtualenv |
| `/var/www/aichatassist-dashboard` | Built frontend assets served by Nginx |
| `/home/frappe/aichatassist-data/uploads` | Persistent uploads (survives redeploys) |
| `/home/frappe/ai-chatassist/uploads` | Symlink → persistent uploads above |
| `/etc/aichatassist/backend.env` | Production environment variables |
| `/home/frappe/aichatassist-data/backups/` | Timestamped DB + uploads backups |

### Running Services

| Service | Notes |
|---|---|
| **Backend** | `aichatassist-backend.service` — Gunicorn + Uvicorn, 2 workers, `127.0.0.1:8000` |
| **Nginx** | Proxies `api.*` → backend; serves `dashboard.*` as static files |
| **PostgreSQL** | System systemd service, auto-starts on reboot |
| **Redis** | Required in production for multi-worker WebSocket pub/sub |

### Deploying a New Release

#### Step 1 — Assess incoming changes

```bash
cd /home/frappe/ai-chatassist
git fetch origin
git log --oneline HEAD..origin/main
git diff --stat HEAD..origin/main

# Check for new migrations / package changes
git diff --name-only HEAD..origin/main -- backend/alembic/versions/
git diff HEAD..origin/main -- backend/requirements.txt frontend/package.json
```

#### Step 2 — Backup (always, before touching anything)

```bash
git branch prod-backup-$(date +%Y%m%d-%H%M%S) HEAD

BKDIR=/home/frappe/aichatassist-data/backups/rollout-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BKDIR"
set -a && source /etc/aichatassist/backend.env && set +a
PG_DSN=${DATABASE_URL/postgresql+psycopg2:\/\//postgresql:\/\/}
pg_dump "$PG_DSN" | gzip -c > "$BKDIR/db.sql.gz"
rsync -a --numeric-ids /home/frappe/aichatassist-data/uploads/ "$BKDIR/uploads/"
```

#### Step 3 — Pull latest code

```bash
git stash push -u -m "pre-deploy $(date -Is)" || true
git reset --hard origin/main
```

#### Step 4 — Backend dependencies (if `requirements.txt` changed)

```bash
/home/frappe/ai-chatassist/.venv/bin/pip install -r /home/frappe/ai-chatassist/backend/requirements.txt
```

#### Step 5 — DB migrations (if new migration files)

```bash
sudo systemctl stop aichatassist-backend
set -a && source /etc/aichatassist/backend.env && set +a
cd /home/frappe/ai-chatassist/backend
/home/frappe/ai-chatassist/.venv/bin/alembic upgrade head
sudo systemctl start aichatassist-backend
curl http://127.0.0.1:8000/health   # must return {"status":"ok"}
```

> If no new migrations, just restart: `sudo systemctl restart aichatassist-backend`

#### Step 6 — Frontend (if any frontend files changed)

```bash
cd /home/frappe/ai-chatassist/frontend
npm ci
npm run build
sudo rsync -a --delete /home/frappe/ai-chatassist/frontend/dist/ /var/www/aichatassist-dashboard/
```

> **Widget files** (`widget/chat-widget.js`, `widget/chat-widget.css`) are served via the backend's `StaticFiles` mount. A backend restart is enough — no separate build step.

#### Step 7 — Smoke Tests

```bash
curl https://api.novelofficespace.com/health
curl -o /dev/null -w "%{http_code}" https://dashboard.novelofficespace.com/
curl -I 'https://api.novelofficespace.com/widget/loader.js?key=INVALID'
journalctl -u aichatassist-backend --since '5 min ago' --no-pager -p err
```

### Minimal Deploy Reference

| What changed | Steps needed |
|---|---|
| Widget CSS/JS only | Pull + restart backend |
| Backend code, no new migrations | Pull + restart backend |
| New DB migrations | Pull → stop → `alembic upgrade head` → start |
| Frontend only | Pull → `npm ci && npm run build` → rsync |
| Full release | All of Steps 1–7 |

### Rollback

```bash
git reset --hard prod-backup-YYYYMMDD-HHMMSS
sudo systemctl restart aichatassist-backend

# If frontend was deployed
cd /home/frappe/ai-chatassist/frontend
npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/aichatassist-dashboard/

# If DB migrations were applied
PG_DSN=...
gunzip -c /home/frappe/aichatassist-data/backups/rollout-TIMESTAMP/db.sql.gz | psql "$PG_DSN"
```

---

## Docs Portal

End-user documentation is available at `/docs` (public, no login required).  
Content lives in `frontend/public/docs-content/` as Markdown files.  
Navigation is configured in `frontend/src/config/docsNav.ts`.

To add a new page:
1. Create `frontend/public/docs-content/<section>/<slug>.md`
2. Add an entry to `docsNav.ts`

---

## Quick Reference

| Service | URL |
|---|---|
| **Dashboard** | http://localhost:5173 |
| **API Docs** | http://localhost:8000/docs |
| **Widget Demo** | http://localhost:8080/demo.html |
