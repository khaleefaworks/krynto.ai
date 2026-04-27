# Backend — AI ChatAssist

FastAPI + PostgreSQL backend. Handles REST API, WebSocket connections (visitor + agent), automations, push notifications, and file uploads.

## Stack

- **Python 3.12**, FastAPI, Uvicorn/Gunicorn
- **PostgreSQL** — primary database
- **SQLAlchemy** (sync) — ORM; `db: Session` injected via `Depends`
- **Alembic** — schema migrations
- **Redis** — optional Pub/Sub for cross-worker WebSocket delivery
- **JWT HS256** + bcrypt — authentication
- **slowapi** — rate limiting
- **structlog** — structured JSON logging
- **APScheduler** — background jobs (auto-close inactive conversations)
- **pydantic-settings** — typed env config

## Directory structure

```
backend/
├── alembic/              # Migration scripts
│   └── versions/
├── app/
│   ├── main.py           # App factory, router registration, lifespan
│   ├── api/              # FastAPI routers + Pydantic schemas (co-located)
│   │   ├── ws_chat.py    # Visitor WebSocket  /ws/chat/{website_id}
│   │   ├── ws_agent.py   # Agent WebSocket    /ws/agent/0
│   │   ├── ws_presence.py# Presence heartbeat /ws/presence/{website_id}
│   │   ├── auth.py       # /auth/*
│   │   ├── chats.py      # /chats/*
│   │   ├── conversations.py
│   │   ├── websites.py
│   │   ├── users.py
│   │   ├── widget.py     # Public widget endpoints
│   │   ├── automations.py
│   │   ├── teams_overview.py
│   │   ├── analytics.py
│   │   ├── push.py
│   │   ├── ratings.py
│   │   ├── tags.py
│   │   ├── attachments.py
│   │   ├── shortcuts.py / website_shortcuts.py
│   │   ├── website_teams.py
│   │   ├── agent_assignments.py
│   │   ├── conversation_metadata.py
│   │   ├── customers.py
│   │   ├── organization.py
│   │   ├── admin.py      # /admin/* (system manager only)
│   │   ├── health.py
│   │   ├── metrics.py
│   │   ├── deps.py       # Shared FastAPI dependencies (get_db, get_current_user)
│   │   └── message_presenter.py  # serialize_message() — shared REST/WS schema
│   ├── core/
│   │   ├── config.py     # pydantic-settings Settings class
│   │   ├── database.py   # SQLAlchemy engine + SessionLocal
│   │   ├── security.py   # JWT encode/decode, bcrypt, token invalidation
│   │   ├── logging.py    # structlog setup
│   │   ├── limiter.py    # slowapi instance
│   │   └── widget_origin.py  # Domain validation for widget CORS
│   ├── infra/
│   │   ├── realtime_bus.py   # Redis Pub/Sub (BusEvent publish/subscribe)
│   │   ├── metrics.py        # Prometheus-style counters
│   │   └── ws_rate_limit.py  # Per-session WS message rate limiter
│   ├── models/           # SQLAlchemy ORM models (one file per entity)
│   │   ├── user.py
│   │   ├── organization.py
│   │   ├── website.py
│   │   ├── conversation.py
│   │   ├── message.py
│   │   ├── automation.py
│   │   └── ...
│   ├── repos/            # DB query functions — accept db: Session, return ORM objects
│   │   ├── conversations.py
│   │   ├── messages.py
│   │   ├── users.py
│   │   └── ...
│   ├── services/         # Business logic
│   │   ├── conversation_orchestrator.py  # Central message router (single source of truth)
│   │   ├── agent_service.py       # Agent WS registry, heartbeat TTL (75 s)
│   │   ├── chat_service.py        # Visitor WS registry, session-level delivery
│   │   ├── conversation_service.py# Conversation lifecycle (get/create, resolve, close)
│   │   ├── automation_service.py  # Execute automation rules
│   │   ├── agent_resolver.py      # Eligibility filtering (org, website, team)
│   │   ├── website_resolver.py    # Online/offline detection + office hours
│   │   ├── visibility.py          # compute_visibility_scope() — role-based data access
│   │   ├── office_hours.py        # Business hours evaluation
│   │   ├── push_service.py        # Web Push (VAPID)
│   │   ├── email_service.py       # Transactional email (Resend)
│   │   ├── presence_service.py    # Agent online presence
│   │   └── auto_close_scheduler.py # APScheduler job
│   └── middleware/
│       └── logging_middleware.py  # Request-scoped log context
├── tests/                # pytest — SQLite in-memory, no real DB needed
├── requirements.txt
├── requirements.lock.txt
├── alembic.ini
├── start_server.sh       # Gunicorn launch script
├── seed_data.py
└── reset_application.py  # Dev-only: wipe + reseed DB
```

## Environment variables

Create `backend/.env` (copy from `.env.example`):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL DSN — `postgresql+psycopg2://user:pass@host/db` |
| `SECRET_KEY` | ✅ | Random 32-byte hex string — `openssl rand -hex 32` |
| `ENV` | | `development` (default) or `production` |
| `PUBLIC_BASE_URL` | | Backend public URL — e.g. `https://api.example.com` |
| `FRONTEND_URL` | | Frontend public URL — used in email links |
| `CORS_ALLOWED_ORIGINS` | | Comma-separated allowed origins (required in production) |
| `REDIS_URL` | | `redis://localhost:6379` — enables multi-worker Pub/Sub |
| `UPLOADS_DIR` | | Absolute path for file uploads (default: `<repo-root>/uploads`) |
| `RESEND_API_KEY` | | Transactional email via Resend |
| `FROM_EMAIL` | | Sender address — `AI ChatAssist <noreply@example.com>` |
| `VAPID_PUBLIC_KEY` | | Web Push public key |
| `VAPID_PRIVATE_KEY` | | Web Push private key |
| `VAPID_SUBJECT` | | Web Push subject — `mailto:you@example.com` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | | JWT TTL (default: 1440 — 24 h) |
| `RATE_LIMIT_ENABLED` | | `true` / `false` (default: `true`) |

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Database
sudo -u postgres psql -c "CREATE USER chatassist WITH PASSWORD 'chatassist';"
sudo -u postgres psql -c "CREATE DATABASE chatassist OWNER chatassist;"

# Configure
cp .env.example .env   # then edit

# Migrate
alembic upgrade head

# Seed (dev only)
python reset_application.py --seed

# Run (development)
uvicorn app.main:app --reload --port 8000

# Run (production)
./start_server.sh
```

## Key patterns

### Repository pattern
All DB queries live in `repos/`. Functions accept `db: Session` and return ORM objects or primitives. Routers never query the DB directly.

```python
# repos/conversations.py
def get_conversation_by_session(db: Session, session_id: str) -> Conversation | None: ...

# api/chats.py
conv = get_conversation_by_session(db, session_id)
```

### ConversationOrchestrator
Single authority for all message routing decisions. Both `ws_chat.py` and `ws_agent.py` call into the orchestrator — never into each other.

```
ws_chat.py  → ConversationOrchestrator.handle_visitor_message()
ws_agent.py → ConversationOrchestrator.handle_agent_message()
```

### Single agent socket
All agents connect to `WS /ws/agent/0` (not per-website). This normalises delivery: the orchestrator always knows where to find any agent.

### RealtimeBus (Redis Pub/Sub)
When a message needs to reach a WebSocket on a different worker:
1. `realtime_bus.publish(BusEvent(...))` — write to Redis channel
2. All workers subscribe; each calls `deliver_bus_event()` on receipt
3. Worker with the matching WS connection delivers locally

Single-worker: Redis not needed, all delivery is in-process.

### JWT invalidation
Tokens include `iat`. On each request, `iat` is compared against:
- `SystemSettings.last_reset_at` — platform-wide reset
- `User.password_changed_at` — per-user password change

No token blacklist needed.

## WebSocket events

### Visitor socket (`/ws/chat/{website_id}`)

**Sent by visitor:**
```json
{ "type": "message", "message": { "content": "Hello" } }
{ "type": "typing_start" }
{ "type": "typing_stop" }
{ "type": "end_chat" }
{ "type": "submit_rating", "rating": 5, "comment": "..." }
```

**Received by visitor:**
```json
{ "type": "message", "message": { ... } }
{ "type": "agent_typing" }
{ "type": "conversation_assigned", "agent": { ... } }
{ "type": "conversation_closed" }
{ "type": "rating_request" }
```

### Agent socket (`/ws/agent/0`)

**Sent by agent:**
```json
{ "type": "message", "payload": { "conversation_id": 1, "content": "Hi" } }
{ "type": "typing_start", "payload": { "conversation_id": 1 } }
{ "type": "heartbeat" }
```

**Received by agent:**
```json
{ "type": "visitor_message",      "payload": { ... } }
{ "type": "agent_message",        "payload": { ... } }
{ "type": "system_message",       "payload": { ... } }
{ "type": "visitor_typing",       "payload": { ... } }
{ "type": "agent_typing",         "payload": { ... } }
{ "type": "conversation_new",     "payload": { ... } }
{ "type": "conversation_assigned","payload": { ... } }
{ "type": "conversation_closed",  "payload": { ... } }
{ "type": "new_chat",             "payload": { ... } }
```

## Running tests

```bash
source .venv/bin/activate
pytest tests/ -v

# Single file
pytest tests/test_chat_service.py -v

# With coverage
pytest tests/ --cov=app --cov-report=term-missing
```

Tests use SQLite in-memory. No PostgreSQL, Redis, or email services needed.

## Alembic cheatsheet

```bash
# Apply all pending migrations
alembic upgrade head

# Create a new migration (after changing a model)
alembic revision --autogenerate -m "add column X to table Y"

# Check current state
alembic current

# Downgrade one step
alembic downgrade -1
```
