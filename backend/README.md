# AI ChatAssist - Backend

FastAPI + PostgreSQL backend for AI-powered chat support system with human agent fallback.

## Tech Stack

- **FastAPI** - Modern async web framework
- **PostgreSQL** - Production database
- **SQLAlchemy** - ORM
- **Alembic** - Database migrations
- **Uvicorn** - ASGI server

## Prerequisites

- Python 3.12+
- PostgreSQL 16+ (installed natively)

## Setup

### 1. Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
```

### 2. Create Database and User

```bash
sudo -u postgres psql -c "CREATE USER chatassist WITH PASSWORD 'chatassist';"
sudo -u postgres psql -c "CREATE DATABASE chatassist OWNER chatassist;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE chatassist TO chatassist;"
```

### 3. Create Virtual Environment

```bash
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
```

### 4. Configure Environment

Create `.env` file in `backend/` directory:

```env
DATABASE_URL=postgresql+psycopg2://chatassist:chatassist@localhost:5432/chatassist
ENV=development
```

### 5. Run Database Migrations

```bash
alembic upgrade head
```

### 6. Start Development Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Or with explicit Python path:

```bash
PYTHONPATH=/home/frappe/Applications/ai-chatassist/backend uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /health` - Health check endpoint

## Database Schema

### Tables

- **websites** - Website configurations (domain, AI instructions)
- **agents** - Support agents (email, active status)
- **conversations** - Chat sessions (website_id, session_id, status)
- **messages** - Chat messages (conversation_id, sender, content)

## Alembic Commands

```bash
# Generate new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# View migration history
alembic history
```

## Project Structure

```
backend/
├── alembic/              # Database migrations
│   ├── versions/         # Migration files
│   ├── env.py           # Alembic environment config
│   └── script.py.mako   # Migration template
├── app/
│   ├── api/             # API routes
│   │   └── health.py    # Health check endpoint
│   ├── core/            # Core functionality
│   │   ├── config.py    # Settings management
│   │   ├── database.py  # Database connection
│   │   └── logging.py   # Logging setup
│   ├── models/          # SQLAlchemy models
│   │   ├── agent.py
│   │   ├── conversation.py
│   │   ├── message.py
│   │   └── website.py
│   └── main.py          # FastAPI application
├── .env                 # Environment variables (create this)
├── alembic.ini          # Alembic configuration
└── requirements.txt     # Python dependencies
```

## Development Notes

- Database migrations are tracked with Alembic
- All models include `created_at` and `updated_at` timestamps
- Environment variables are loaded from `.env` file
- PostgreSQL runs natively (not containerized)
