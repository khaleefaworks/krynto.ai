# Quick Start — AI ChatAssist

Step-by-step guide to run the **backend**, **frontend dashboard**, and **chat widget** locally for development.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the Repository](#2-clone-the-repository)
3. [Database Setup (PostgreSQL)](#3-database-setup-postgresql)
4. [Backend Setup](#4-backend-setup)
5. [Frontend Dashboard](#5-frontend-dashboard)
6. [Widget Demo](#6-widget-demo)
7. [Optional Services](#7-optional-services)
   - [Push Notifications (VAPID)](#71-push-notifications-vapid)
   - [Email via Resend](#72-email-via-resend)
   - [Redis](#73-redis)
8. [Health Checks](#8-health-checks)
9. [Running Tests](#9-running-tests)
10. [Reset Application (Development Only)](#10-reset-application-development-only)
11. [Troubleshooting](#11-troubleshooting)
12. [Production Deployment](#12-production-deployment)

---

## 1. Prerequisites

Install system dependencies (Ubuntu/Debian):

```bash
sudo apt update
sudo apt install -y git build-essential python3 python3-venv python3-pip nodejs npm postgresql postgresql-contrib
```

> **Tip:** Use [nvm](https://github.com/nvm-sh/nvm) to install and manage Node.js (LTS recommended).


Make sure PostgreSQL is running:

```bash
sudo systemctl enable --now postgresql
```

---

## 2. Clone the Repository

```bash
git clone <your-repo-url> ~/Applications/ai-chatassist
cd ~/Applications/ai-chatassist
```

---

## 3. Database Setup (PostgreSQL)

Create a Postgres user and database:

```bash
sudo -u postgres createuser -P chatassist       # enter a password when prompted
sudo -u postgres createdb -O chatassist chatassist
```

Verify connectivity:

```bash
psql "postgresql://chatassist:<your_password>@localhost:5432/chatassist" -c "SELECT 1;"
```

---

## 4. Backend Setup

### 4.1 Create virtualenv and install dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.lock.txt || pip install -r requirements.txt
```

### 4.2 Configure environment variables

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

> The app reads `backend/.env` via `app/core/config.py`.
> See `backend/.env.example` for the full list of available keys and their defaults.

### 4.3 Run migrations and start the server

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

## 5. Frontend Dashboard

Open a **new terminal**:

```bash
cd frontend
npm ci
npm run dev
```

> Dashboard: http://localhost:5173

---

## 6. Widget Demo

Open a **new terminal**:

```bash
cd widget
python3 -m http.server 8080
```

> Widget demo: http://localhost:8080/demo.html

---

## 7. Optional Services

These services are **not required** to run the app locally but enable additional features.

### 7.1 Push Notifications (VAPID)

Generate VAPID keys:

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

### 7.2 Email via Resend

The app uses [Resend](https://resend.com) for transactional email (OTP, password reset, welcome).

1. Sign up at https://resend.com and create an API key.
2. Add these to `backend/.env`:

```env
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL="AI ChatAssist <onboarding@resend.dev>"
FRONTEND_URL=http://localhost:5173
RESEND_OVERRIDE_TO_EMAIL=your-email@example.com
```

> **Development note:** When using Resend's shared test domain (`onboarding@resend.dev`), set `RESEND_OVERRIDE_TO_EMAIL` to your verified Resend email. This redirects all outgoing mail to that address. Remove it once you verify a custom domain.

See `app/services/email_service.py` for implementation details.

### 7.3 Redis

Redis enables WebSocket rate-limiting and multi-worker pub/sub. Without it, the app falls back to in-memory mode (fine for single-process local dev).

**Install via apt:**

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
```

**Or via Docker:**

```bash
docker run -d --name redis -p 6379:6379 redis:7
```

**Verify:**

```bash
redis-cli PING   # should return PONG
```

Set in `backend/.env`:

```env
REDIS_URL=redis://127.0.0.1:6379/0
```

---

## 8. Health Checks

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Basic liveness probe |
| `GET /health/ready` | Checks DB + Redis (if configured) |

```bash
curl http://localhost:8000/health/ready
```

> When `REDIS_URL` is not set, the readiness response shows `"redis": "disabled"`.

---

## 9. Running Tests

From `backend/` with the virtualenv active:

```bash
pytest -q
```

> Some tests mock/disable Redis — see `backend/tests/` for details.

---

## 10. Reset Application (Development Only)

**Back up first:**

```bash
sudo -u postgres pg_dump -Fc -f backup.dump chatassist
```

**⚠️ Reset (destructive: deletes uploads, truncates tables, resets sequences):**

```bash
cd backend
source .venv/bin/activate
python3 reset_application.py            # interactive — type YES to confirm
python3 reset_application.py --seed     # reset + seed test data
```

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `start_server.sh` reports missing virtualenv | Create it: `python3 -m venv backend/.venv` and activate |
| DB connectivity fails | Check `DATABASE_URL` in `.env`; verify Postgres is running on the expected host/port |
| Email sending fails in dev | Set `RESEND_OVERRIDE_TO_EMAIL` when using Resend's shared test domain |
| Frontend build errors | Delete `node_modules/` and run `npm ci` |
| Push notifications not working | Ensure VAPID keys are set in `.env` and backend is restarted |

---

## 12. Production Deployment

> This section documents how the app is currently deployed and maintained on the **novelofficespace.com** production server. Refer here whenever you need to deploy a new release or troubleshoot the live environment.

### Server Layout

| Path | Purpose |
|---|---|
| `/home/frappe/ai-chatassist` | Git repo — single source of truth for all code |
| `/home/frappe/ai-chatassist/.venv` | Python virtualenv for the backend |
| `/var/www/aichatassist-dashboard` | Built frontend assets served by Nginx |
| `/home/frappe/aichatassist-data/uploads` | Persistent user uploads (avatars, attachments) — survives redeploys |
| `/home/frappe/ai-chatassist/uploads` | Symlink → the persistent uploads directory above |
| `/etc/aichatassist/backend.env` | Production environment variables (DB, keys, etc.) |
| `/home/frappe/aichatassist-data/backups/` | Timestamped DB + uploads backups taken before each release |

### Running Services

| Service | Config | Notes |
|---|---|---|
| **Backend** | `aichatassist-backend.service` (systemd) | Gunicorn + Uvicorn, 2 workers, binds to `127.0.0.1:8000` |
| **Nginx** | `/etc/nginx/sites-enabled/` | Proxies `api.novelofficespace.com` → backend; serves `dashboard.novelofficespace.com` as static files |
| **PostgreSQL** | System systemd service | Enabled; auto-starts on reboot |
| **Redis** | System systemd service | Enabled; required in production for multi-worker WebSocket pub/sub |

> **Server reboot:** All four services are `enabled` via systemd and will come back up automatically on a reboot — no manual action needed.

### Deploying a New Release

Every deployment follows these steps in order:

#### Step 1 — Assess incoming changes

```bash
cd /home/frappe/ai-chatassist
git fetch origin

# What's coming in?
git log --oneline HEAD..origin/main
git diff --stat HEAD..origin/main

# New DB migrations?
git diff --name-only HEAD..origin/main -- backend/alembic/versions/

# New backend or frontend packages?
git diff HEAD..origin/main -- backend/requirements.txt
git diff HEAD..origin/main -- frontend/package.json
```

#### Step 2 — Backup (always, before touching anything)

```bash
cd /home/frappe/ai-chatassist

# Git rollback pointer
git branch prod-backup-$(date +%Y%m%d-%H%M%S) HEAD

# DB + uploads backup
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

#### Step 5 — DB migrations (if new migration files were added)

```bash
# Stop backend during schema changes to prevent conflicts
sudo systemctl stop aichatassist-backend

set -a && source /etc/aichatassist/backend.env && set +a
cd /home/frappe/ai-chatassist/backend
/home/frappe/ai-chatassist/.venv/bin/alembic upgrade head

sudo systemctl start aichatassist-backend
curl http://127.0.0.1:8000/health   # must return {"status":"ok"}
```

> If there are **no new migrations**, just restart instead:
> ```bash
> sudo systemctl restart aichatassist-backend
> ```

#### Step 6 — Frontend (if any frontend files changed)

```bash
cd /home/frappe/ai-chatassist/frontend
npm ci
npm run build
sudo rsync -a --delete /home/frappe/ai-chatassist/frontend/dist/ /var/www/aichatassist-dashboard/
```

Nginx starts serving the new files immediately — no Nginx restart required.

> **Widget files** (`widget/chat-widget.js`, `widget/chat-widget.css`) are served directly from the repo via the backend's `StaticFiles` mount at `/widget`. A backend restart after pulling is enough to pick up widget changes — no separate build step.

#### Step 7 — Smoke Tests

```bash
# API health
curl https://api.novelofficespace.com/health
# → {"status":"ok"}

# Dashboard loads
curl -o /dev/null -w "%{http_code}" https://dashboard.novelofficespace.com/
# → 200

# Widget loader returns JS even for an invalid key (ORB-safe)
curl -I 'https://api.novelofficespace.com/widget/loader.js?key=INVALID'
# → Content-Type: application/javascript

# No errors in backend log
journalctl -u aichatassist-backend --since '5 min ago' --no-pager -p err
```

### Minimal Deploy Reference

| What changed | Steps needed |
|---|---|
| Widget CSS/JS only | Pull code + `sudo systemctl restart aichatassist-backend` |
| Backend code, no new migrations | Pull code + `sudo systemctl restart aichatassist-backend` |
| New DB migrations | Pull → stop backend → `alembic upgrade head` → start backend |
| Frontend only | Pull → `npm ci && npm run build` → rsync to dashboard root |
| Full release (code + migrations + frontend) | All of Steps 1–7 above |

### Rollback (if something breaks)

```bash
# Restore code to the last backup branch
git reset --hard prod-backup-YYYYMMDD-HHMMSS
sudo systemctl restart aichatassist-backend

# Rebuild frontend if frontend was deployed
cd /home/frappe/ai-chatassist/frontend
npm ci && npm run build
sudo rsync -a --delete /home/frappe/ai-chatassist/frontend/dist/ /var/www/aichatassist-dashboard/

# If DB migrations were applied, restore from backup
set -a && source /etc/aichatassist/backend.env && set +a
PG_DSN=${DATABASE_URL/postgresql+psycopg2:\/\//postgresql:\/\/}
gunzip -c /home/frappe/aichatassist-data/backups/rollout-TIMESTAMP/db.sql.gz | psql "$PG_DSN"
```

---

## Quick Reference

| Service | URL |
|---|---|
| **Dashboard** | http://localhost:5173 |
| **API Docs** | http://localhost:8000/docs |
| **Widget Demo** | http://localhost:8080/demo.html |
