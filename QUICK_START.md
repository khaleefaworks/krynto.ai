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

## Quick Reference

| Service | URL |
|---|---|
| **Dashboard** | http://localhost:5173 |
| **API Docs** | http://localhost:8000/docs |
| **Widget Demo** | http://localhost:8080/demo.html |
