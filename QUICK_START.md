# Quick Start - Run All these Services

The  file explains how to get this  project runs 

## Pre-requirements  (install system packages)
Install system dependencies (example for Ubuntu):
```bash
sudo apt update
sudo apt install -y git build-essential python3 python3-venv python3-pip nodejs npm postgresql postgresql-contrib
```
- Install Node.js .
- Make sure PostgreSQL is running and you can create a database/user.


## Now Clone repository

```bash
git clone <your-repo-url> 

change the directory to ~/Applications/ai-chatassist
```



## For the Backend - First create the virtualenv & install

```bash
# Quick Start — Run All Services (new machine)

This guide shows a minimal, reproducible workflow to run the backend, frontend, and widget locally for development. It follows the repository conventions (backend uses `backend/.env`).

## 1. Prerequisites (Ubuntu/Debian)
Install system dependencies (example):

```bash
sudo apt update
sudo apt install -y git build-essential python3 python3-venv python3-pip nodejs npm postgresql postgresql-contrib
```

- Recommend Node LTS (use `nvm` to manage Node versions).
- PostgreSQL is required for development. Redis is optional (see Redis section).

## 2. Clone repository
# Quick Start — Run All Services

This guide shows a minimal, reproducible workflow to run the backend, frontend, and widget locally for development. It follows the repository conventions (backend loads `backend/.env`).

## Prerequisites (Ubuntu/Debian)

Install system dependencies (example):

```bash
sudo apt update
sudo apt install -y git build-essential python3 python3-venv python3-pip nodejs npm postgresql postgresql-contrib
```

- Recommend Node LTS (use `nvm` to manage Node versions).
- PostgreSQL is required for development. Redis is optional (see Redis section).

## Clone repository

```bash
git clone <your-repo-url> ~/Applications/ai-chatassist
cd ~/Applications/ai-chatassist
```

## Backend — virtualenv & dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
# Prefer the locked deps when available
pip install -r requirements.lock.txt || pip install -r requirements.txt
```

### Configure environment

Copy and edit the example env file:

```bash
cp .env.example .env
# Edit backend/.env and set at minimum: DATABASE_URL, SECRET_KEY
```

Common env keys (examples):

```env
ENV=development
DATABASE_URL=postgresql+psycopg2://chatassist:chatassist_pass@localhost:5432/chatassist
SECRET_KEY=dev-only-change-me
PUBLIC_BASE_URL=http://localhost:8000
# Optional Redis (see Redis section)
REDIS_URL=redis://127.0.0.1:6379/0
# Web Push (VAPID)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:dev@localhost
# Email (Resend)
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL="AI ChatAssist <onboarding@resend.dev>"
FRONTEND_URL=http://localhost:5173
RESEND_OVERRIDE_TO_EMAIL=your-email@example.com
```

Notes:
- The app reads `backend/.env` via `app/core/config.py`.
- Use `REDIS_URL` only if you need Redis-backed features (rate-limiting, multi-worker pub/sub).

## Database setup

Create a Postgres role and database (example matching `.env.example`):

```bash
sudo -u postgres createuser -P chatassist   # choose a secure password
sudo -u postgres createdb -O chatassist chatassist
```

Verify connectivity:

```bash
psql "postgresql://chatassist:your_password@localhost:5432/chatassist" -c "SELECT 1;"
```

## Run migrations & start backend

Option A (recommended — auto-migrate on start):

```bash
cd backend
source .venv/bin/activate
RUN_MIGRATIONS=1 ./start_server.sh
```

Option B (manual migrations):

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
./start_server.sh
```

`start_server.sh` performs preflight checks (venv, DB connectivity) and starts Uvicorn on `:8000`.

API docs: http://localhost:8000/docs

## Frontend (dashboard)

In a new terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open: http://localhost:5173 
## Widget demo (static)

```bash
cd widget
python3 -m http.server 8080
```

Open: http://localhost:8080/demo.html

## VAPID / Push notifications (development)

Generate keys from the frontend folder and paste into `backend/.env`:

```bash
cd frontend
npx --yes web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in `backend/.env`, then restart the backend.

## Email (Resend) — development notes

This app uses Resend for transactional email (OTP, password reset, welcome).

1. Sign up at https://resend.com and create an API key.
2. Add `RESEND_API_KEY`, `FROM_EMAIL`, and `FRONTEND_URL` to `backend/.env`.
3. If using Resend's shared test domain (`onboarding@resend.dev`), set `RESEND_OVERRIDE_TO_EMAIL` to your verified Resend address to redirect all outgoing mail during development.

Example env (in `.env.example`):

```env
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL="AI ChatAssist <onboarding@resend.dev>"
FRONTEND_URL=http://localhost:5173
RESEND_OVERRIDE_TO_EMAIL=your-email@example.com
```

The `EmailService` wrapper uses these vars and honors `RESEND_OVERRIDE_TO_EMAIL` (see `app/services/email_service.py`).

## Redis (optional — development)

When `REDIS_URL` is configured the app uses Redis for websocket rate-limiting and multi-worker pub/sub. If unset, the app falls back to in-memory behavior appropriate for single-process local dev.

Install & run Redis (Ubuntu):

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
```

Or run with Docker:

```bash
docker run -d --name redis -p 6379:6379 redis:7
```

Verify:

```bash
redis-cli -h 127.0.0.1 -p 6379 PING   # should return PONG
```

If running in containers, set `REDIS_URL` to the container hostname (e.g. `redis://redis:6379/0`).

## Health checks

- Liveness: `GET /health/live` — basic liveness probe.
- Readiness: `GET /health/ready` — checks DB and (if configured) Redis:

```bash
curl http://localhost:8000/health/ready
```

When `REDIS_URL` is not set the readiness response shows `"redis": "disabled"`.

## Reset application (development only)

Back up DB before wiping:

```bash
sudo -u postgres pg_dump -Fc -f backup.dump chatassist
```

Reset (destructive):

```bash
cd backend
source .venv/bin/activate
python3 reset_application.py        # interactive — type YES to confirm
# Or reset + seed test data:
python3 reset_application.py --seed
```

This deletes uploaded files, truncates tables, resets sequences, and (with `--seed`) repopulates test data.

## Running tests (backend)

From `backend/` with venv active:

```bash
pytest -q
```

Some tests mock/disable Redis — see `backend/tests/` for details.

## Troubleshooting

- If `start_server.sh` reports a missing virtualenv, create `backend/.venv` or activate your venv.
- If DB connectivity fails, verify `DATABASE_URL` and Postgres is listening on the expected host/port.
- If email sending fails in dev, ensure `RESEND_OVERRIDE_TO_EMAIL` is set when using Resend's shared test domain.
- If frontend build errors occur, remove `node_modules` and run `npm ci`.

---

## Summary

- Dashboard: http://localhost:5173
- API Docs: http://localhost:8000/docs
- Widget Demo: http://localhost:8080/demo.html
